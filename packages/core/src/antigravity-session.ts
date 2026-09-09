import { spawn, type ChildProcess } from "node:child_process"
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

// Long-lived agy conversation engine. One agy child process owns a single
// native Antigravity conversation; OpenCode writes one NDJSON user event per
// turn and keeps stdin open between turns. agy is the source of truth for the
// model history, so a continuation turn carries only the new user text.

export type AgyEffort = "low" | "medium" | "high"

export type AgyTurnSummary = {
  readonly conversationID: string
  // Whole parsed `result` event line so callers can derive usage/cost/meta.
  readonly event: Record<string, unknown>
  // Per-turn usage counters (delta vs the previous result). agy reports usage
  // as conversation-cumulative across processes, so the baseline is persisted
  // and survives an OpenCode restart; falls back to the raw cumulative when no
  // previous baseline exists or the counters went backwards.
  readonly countersDelta?: Record<string, number>
  // True when the turn was not actually sent because the session is closing.
  readonly dropped: boolean
}

export type AgySessionSpec = {
  readonly key: string
  readonly binary: string
  readonly cwd: string
  readonly model: string
  readonly effort?: AgyEffort
  // Resume an existing native conversation instead of creating a new one.
  readonly conversationID?: string
  readonly alwaysProceed: boolean
  // OpenCode-owned directory holding the per-session sidecar files (one JSON
  // per session key), NOT agy's private cache dir. agy may clean/reorganize its
  // own cache; this mapping is OpenCode's and lives under its data dir.
  readonly stateDir?: string
}

export type AgyTurnSpec = {
  readonly text: string
  // Called for every parsed stream event belonging to this turn (tool steps,
  // text deltas, ...). The terminal `result` event is delivered via the
  // returned summary instead.
  readonly onEvent?: (event: unknown) => void
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

const IDLE_CLOSE_MS = 15 * 60_000
const TURN_TIMEOUT_MS = 20 * 60_000
const START_TIMEOUT_MS = 30_000
const POOL_MAX = 12

type PersistedSession = {
  readonly conversationID?: string
  readonly dir?: string
  readonly at?: number
  readonly usage?: Record<string, number>
}

// OpenCode data dir fallback (mirrors core's Global data dir without importing
// the effectful global module). The authoritative path is passed by OpenCode.
function defaultDataDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.LOCALAPPDATA
    return appData ? path.join(appData, "opencode") : path.join(os.homedir(), ".local", "share", "opencode")
  }
  const xdg = process.env.XDG_DATA_HOME
  return xdg ? path.join(xdg, "opencode") : path.join(os.homedir(), ".local", "share", "opencode")
}

function defaultStateDir(): string {
  return path.join(defaultDataDir(), "antigravity")
}

function statePath(stateDir: string, key: string): string {
  const safe = key.replace(/[^A-Za-z0-9._-]/g, "_")
  return path.join(stateDir, `session-${safe}.json`)
}

// One file per session key: two OpenCode instances writing different sessions
// can never clobber each other's entries (no shared read-modify-write file).
// Writes go through temp file + rename so a reader never observes a torn JSON.
// Synchronous on purpose: the baseline must be on disk before the turn resolves
// so a kill+resume in another process reads the latest cumulative counters.
function readPersisted(stateDir: string, key: string): PersistedSession {
  try {
    const entry = JSON.parse(readFileSync(statePath(stateDir, key), "utf8")) as unknown
    if (typeof entry !== "object" || entry === null) return {}
    const record = entry as Record<string, unknown>
    const usage = record.usage
    return {
      conversationID: typeof record.conversationID === "string" ? record.conversationID : undefined,
      dir: typeof record.dir === "string" ? record.dir : undefined,
      at: typeof record.at === "number" ? record.at : undefined,
      usage: typeof usage === "object" && usage !== null ? (usage as Record<string, number>) : undefined,
    }
  } catch {
    return {}
  }
}

function writePersisted(stateDir: string, key: string, entry: PersistedSession): void {
  const file = statePath(stateDir, key)
  const temp = `${file}.${process.pid}.tmp`
  try {
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(temp, JSON.stringify(entry))
    renameSync(temp, file)
  } catch {
    try {
      unlinkSync(temp)
    } catch {}
  }
}

function countersOfEvent(event: Record<string, unknown>): Record<string, number> {
  const payload = record(event.result) ? event.result : event
  const source = record(payload.usage) ? payload.usage : payload
  const result: Record<string, number> = {}
  for (const key of [
    "input_tokens",
    "output_tokens",
    "thinking_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "total_tokens",
  ]) {
    const value = source[key]
    if (typeof value === "number") result[key] = value
  }
  return result
}

function diffCounters(current: Record<string, number>, previous: Record<string, number>): Record<string, number> {
  if (Object.keys(current).length === 0) return {}
  if (Object.keys(previous).length === 0) return current
  const delta: Record<string, number> = {}
  for (const key of Object.keys(current)) {
    const value = current[key] - (previous[key] ?? 0)
    if (value < 0) return current
    if (value !== 0) delta[key] = value
  }
  return delta
}

type Turn = AgyTurnSpec & {
  readonly resolve: (summary: AgyTurnSummary) => void
  readonly reject: (error: Error) => void
  sink: ((event: unknown) => void) | undefined
}

export class AgyConversation {
  private readonly spec: AgySessionSpec
  private child: ChildProcess | undefined
  private stdoutBuffer = ""
  private stderr = ""
  private conversationId: string | undefined
  private readonly resumeTarget: string | undefined
  private state: "new" | "starting" | "ready" | "turn" | "closing" | "closed" | "exited" = "new"
  private readonly queue: Turn[] = []
  private active: Turn | undefined
  private initPromise: Promise<void> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private turnTimer: ReturnType<typeof setTimeout> | undefined
  private closeAfterActive = false
  private interruptRequested = false
  private lastCounters: Record<string, number> = {}

  constructor(spec: AgySessionSpec) {
    this.spec = spec
    // Fall back to the persisted session mapping when OpenCode cannot supply an
    // exact id (crash before any assistant message reached disk).
    const persisted = readPersisted(this.stateDir(), spec.key)
    const matching = persisted?.dir === spec.cwd
    this.resumeTarget = spec.conversationID ?? (matching ? persisted?.conversationID : undefined)
    // agy usage counters are conversation-cumulative (they continue across
    // processes), so seed the delta baseline from the persisted conversation.
    if (matching && (spec.conversationID === undefined || spec.conversationID === persisted?.conversationID)) {
      if (persisted?.usage) this.lastCounters = { ...persisted.usage }
    }
  }

  private stateDir(): string {
    return this.spec.stateDir ?? defaultStateDir()
  }

  get conversationID(): string | undefined {
    return this.conversationId ?? this.resumeTarget
  }

  get model(): string {
    return this.spec.model
  }

  get effort(): AgyEffort | undefined {
    return this.spec.effort
  }

  get alwaysProceed(): boolean {
    return this.spec.alwaysProceed
  }

  get busy(): boolean {
    return this.state === "turn" || this.state === "starting" || this.queue.length > 0
  }

  get unavailable(): boolean {
    return this.state === "closing" || this.state === "closed"
  }

  // Sends one user turn and resolves when the matching `result` event arrives.
  // If the process died meanwhile, a new one is spawned transparently, resuming
  // the same native conversation through --conversation.
  turn(input: AgyTurnSpec): Promise<AgyTurnSummary> {
    if (this.state === "closing" || this.state === "closed") {
      return Promise.resolve({ conversationID: this.conversationId ?? "", event: {}, dropped: true })
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ ...input, resolve, reject, sink: input.onEvent })
      void this.pump()
    })
  }

  // Drops the current turn's event sink (OpenCode aborted the request) and
  // interrupts agy like a human pressing Esc: the process is signalled (SIGINT
  // where possible), the in-flight turn ends as INTERRUPTED, and the child is
  // closed. The next turn respawns with --conversation <id>, so the native
  // conversation is preserved but nothing keeps executing tools afterwards.
  cancelActive(): void {
    const item = this.active
    if (item) item.sink = undefined
    this.interruptChild()
  }

  private interruptChild(): void {
    if (this.interruptRequested) return
    this.interruptRequested = true
    const child = this.child
    if (!child?.pid) return
    try {
      if (process.platform !== "win32") {
        child.kill("SIGINT")
        const timer = setTimeout(() => {
          try {
            child.kill()
          } catch {}
        }, 800)
        timer.unref?.()
        return
      }
      child.kill()
    } catch {}
  }

  // Resolves when the session has no in-flight turn (bounded wait).
  async awaitIdle(timeoutMs = 60_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (this.busy && !this.unavailable) {
      if (Date.now() > deadline) return false
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
    return !this.unavailable
  }

  close(): Promise<void> {
    if (this.state === "closing" || this.state === "closed") return Promise.resolve()
    this.state = "closing"
    this.clearIdle()
    if (this.turnTimer) clearTimeout(this.turnTimer)
    this.rejectQueue(new Error("agy session closed"))
    if (this.active) {
      // Finish the in-flight turn first so agy persists a complete exchange,
      // then end stdin once it drains.
      this.closeAfterActive = true
      return Promise.resolve()
    }
    this.endStdin()
    return Promise.resolve()
  }

  kill(): void {
    this.state = "closed"
    this.clearIdle()
    if (this.turnTimer) clearTimeout(this.turnTimer)
    const child = this.child
    this.child = undefined
    try {
      child?.kill()
    } catch {}
  }

  private pump(): Promise<void> {
    if (this.state === "closing" || this.state === "closed") return Promise.resolve()
    const item = this.active ? undefined : this.queue.shift()
    if (!item) return Promise.resolve()
    this.active = item
    return (async () => {
      try {
        await this.ensureStarted()
        if (this.state === "closing") {
          this.dropped(item)
          return
        }
        this.state = "turn"
        this.clearIdle()
        this.turnTimer = setTimeout(() => this.failActive(new Error("agy turn timed out")), TURN_TIMEOUT_MS)
        this.turnTimer.unref?.()
        const child = this.child
        if (!child?.stdin || child.stdin.destroyed) {
          this.failActive(new Error("agy session is not connected"))
          return
        }
        const text = item.text.trim()
        if (!text) {
          this.finishTurn(item, { conversationID: this.conversationId ?? "", event: {}, dropped: false })
          return
        }
        child.stdin.write(JSON.stringify({ event: "user", message: { content: text } }) + "\n")
      } catch (error) {
        this.failActive(error instanceof Error ? error : new Error(String(error)))
      }
    })()
  }

  private ensureStarted(): Promise<void> {
    if (this.child && (this.state === "ready" || this.state === "turn")) return Promise.resolve()
    if (this.state === "starting" && this.initPromise) return this.initPromise
    this.spawnChild()
    return this.initPromise!
  }

  private spawnChild(): void {
    const resume = this.conversationId ?? this.resumeTarget
    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--model",
      this.spec.model,
      ...(this.spec.effort ? ["--effort", this.spec.effort] : []),
      ...(resume ? ["--conversation", resume] : []),
      ...(this.spec.alwaysProceed ? ["--dangerously-skip-permissions"] : []),
    ]
    this.state = "starting"
    this.stderr = ""
    this.stdoutBuffer = ""

    this.initPromise = new Promise<void>((resolve, reject) => {
      const child = spawn(this.spec.binary, args, {
        cwd: this.spec.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      })
      this.child = child
      if (!child.stdin || !child.stdout || !child.stderr) {
        this.state = "exited"
        reject(new Error("Could not create agy streams"))
        return
      }
      const timeout = setTimeout(() => {
        this.state = "exited"
        reject(new Error(this.stderr.trim() || "agy did not emit an init event"))
        try {
          child.kill()
        } catch {}
      }, START_TIMEOUT_MS)
      timeout.unref?.()

      child.stdin.on("error", () => undefined)
      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (chunk: string) => this.onStdout(chunk, resolve))
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk: string) => {
        this.stderr += chunk
      })
      child.once("error", (error) => {
        this.child = undefined
        this.state = "exited"
        reject(error)
      })
      child.once("exit", (code) => {
        this.child = undefined
        if (this.state === "starting") {
          this.state = "exited"
          reject(
            code === 0
              ? new Error(this.stderr.trim() || "agy exited during startup")
              : new Error(this.stderr.trim() || `agy exited with code ${code}`),
          )
          return
        }
        if (this.state === "closing") {
          this.state = "closed"
          return
        }
        this.state = "exited"
        this.failActive(
          code === 0 ? new Error("agy process exited") : new Error(this.stderr.trim() || `agy exited with code ${code}`),
        )
      })
    })
  }

  private onStdout(chunk: string, resolveInit: () => void): void {
    this.stdoutBuffer += chunk
    const lines = this.stdoutBuffer.split(/\r?\n/)
    this.stdoutBuffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      let event: unknown
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (!record(event)) continue
      if (event.event === "init") {
        if (typeof event.conversation_id === "string") {
          this.conversationId = event.conversation_id
          // Persist the mapping as soon as agy reports the conversation, not
          // only after the assistant reply reaches OpenCode's transcript.
          writePersisted(this.stateDir(), this.spec.key, {
            conversationID: this.conversationId,
            dir: this.spec.cwd,
            at: Date.now(),
          })
        }
        if (this.state === "starting") this.state = "ready"
        resolveInit()
        continue
      }
      if (event.event === "result" && this.active) {
        const counters = countersOfEvent(event)
        const countersDelta = diffCounters(counters, this.lastCounters)
        if (Object.keys(counters).length > 0) {
          this.lastCounters = counters
          // agy usage is conversation-cumulative across processes; persist the
          // latest cumulative counters so a restart can keep producing
          // per-turn deltas instead of an inflated first message.
          writePersisted(this.stateDir(), this.spec.key, {
            conversationID: this.conversationId ?? "",
            dir: this.spec.cwd,
            at: Date.now(),
            usage: counters,
          })
        }
        this.finishTurn(this.active, {
          conversationID: this.conversationId ?? "",
          event,
          countersDelta: Object.keys(countersDelta).length > 0 ? countersDelta : undefined,
          dropped: false,
        })
        if (this.interruptRequested) {
          this.interruptRequested = false
          void this.close()
        }
        continue
      }
      if (this.active?.sink && event.event === "step_update") this.active.sink(event)
    }
  }

  private finishTurn(item: Turn, summary: AgyTurnSummary): void {
    this.active = undefined
    if (this.turnTimer) clearTimeout(this.turnTimer)
    if (this.closeAfterActive) {
      this.state = "closed"
      item.resolve(summary)
      this.endStdin()
      return
    }
    item.resolve(summary)
    if (this.queue.length > 0) {
      void this.pump()
    } else {
      this.state = "ready"
      this.armIdle()
    }
  }

  private dropped(item: Turn): void {
    this.active = undefined
    if (this.turnTimer) clearTimeout(this.turnTimer)
    item.resolve({ conversationID: this.conversationId ?? "", event: {}, dropped: true })
    // close() was called while this turn was starting; mirror the
    // closeAfterActive path and finish shutting the process down.
    this.state = "closed"
    this.endStdin()
  }

  private failActive(error: Error): void {
    const item = this.active
    this.active = undefined
    if (this.turnTimer) clearTimeout(this.turnTimer)
    if (item) item.reject(error)
    if (this.state === "exited" || this.state === "closing" || this.state === "closed") {
      if (this.queue.length > 0) this.rejectQueue(new Error("agy session ended"))
      return
    }
    if (this.queue.length > 0) {
      void this.pump()
    } else {
      this.state = "ready"
      this.armIdle()
    }
  }

  private rejectQueue(error: Error): void {
    while (this.queue.length > 0) this.queue.shift()!.reject(error)
  }

  private armIdle(): void {
    this.clearIdle()
    this.idleTimer = setTimeout(() => {
      if (!this.active && this.queue.length === 0 && this.state === "ready") void this.close()
    }, IDLE_CLOSE_MS)
    this.idleTimer.unref?.()
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  private endStdin(): void {
    const child = this.child
    if (!child?.stdin || child.stdin.destroyed) return
    try {
      child.stdin.end()
    } catch {}
  }
}

const pool = new Map<string, AgyConversation>()
let exitHookInstalled = false

// Bounded pool: each open OpenCode session can hold one agy process alive (agy
// 1.1.27 has an idle high-CPU report), so idle sessions are evicted before the
// pool grows past POOL_MAX. Busy sessions are never closed mid-turn.
function evictIdle(): void {
  if (pool.size < POOL_MAX) return
  const idle: string[] = []
  for (const [key, item] of pool) {
    if (idle.length >= POOL_MAX - 1) break
    if (!item.busy && !item.unavailable) idle.push(key)
  }
  for (const key of idle) {
    const item = pool.get(key)
    if (!item) continue
    pool.delete(key)
    void item.close()
  }
}

// Returns the live session for a key, transparently resuming the same native
// conversation when the model/effort changed or the process is gone. Model
// switches wait for any in-flight turn to finish before closing the old
// process, so two agy processes never write the same conversation at once.
export async function acquireAgyConversation(spec: AgySessionSpec): Promise<AgyConversation> {
  installExitHook()
  const existing = pool.get(spec.key)
  if (existing) {
    const sameModel =
      existing.model === spec.model &&
      existing.effort === spec.effort &&
      existing.alwaysProceed === spec.alwaysProceed
    if (sameModel) {
      if (existing.unavailable) pool.delete(spec.key)
      else return existing
    } else {
      await existing.awaitIdle()
      const reuse = existing.conversationID ?? spec.conversationID
      void existing.close()
      pool.delete(spec.key)
      evictIdle()
      const created = new AgyConversation({ ...spec, conversationID: reuse })
      pool.set(spec.key, created)
      return created
    }
  }
  evictIdle()
  const created = new AgyConversation(spec)
  pool.set(spec.key, created)
  return created
}

export function releaseAgyConversation(key: string): void {
  const item = pool.get(key)
  if (!item) return
  pool.delete(key)
  void item.close()
}

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.once("exit", () => {
    for (const item of pool.values()) item.kill()
    pool.clear()
  })
}
