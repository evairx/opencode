import { spawn as spawnChild } from "node:child_process"
import type { LanguageModelV3, LanguageModelV3StreamPart, SharedV3ProviderMetadata } from "@ai-sdk/provider"
import type { Disp } from "#pty"
import { acquireAgyConversation, type AgyConversation } from "./antigravity-session"

const AUTHORIZATION_URL = /https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?[^\s]+/
const AGY = process.platform === "win32" ? "agy.exe" : "agy"

// Terms note: this adapter drives the official `agy` CLI through its documented
// stream-json protocol; OpenCode never talks to Google directly and never reads
// the OAuth token (auth lives in agy's keyring). Shelling out to the official
// CLI is NOT a guarantee of Antigravity consumer-ToS compliance: Google's FAQ
// names OpenCode as unsupported with an Antigravity product login and recommends
// Vertex/AI Studio API keys for third-party agents. Nothing here evades
// detection, alters telemetry, or reuses extracted credentials.

type OAuthSession = {
  readonly url: string
  readonly complete: (code: string) => Promise<void>
  readonly stop: () => void
}

type RecordValue = Record<string, unknown>
type StreamUsage = Extract<LanguageModelV3StreamPart, { type: "finish" }>["usage"]

function record(input: unknown): input is RecordValue {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function textDelta(input: unknown): string | undefined {
  if (!record(input)) return undefined
  const su = input.step_update
  if (record(su) && typeof su.text_delta === "string") return su.text_delta
  return undefined
}

function toolStep(input: unknown): RecordValue | undefined {
  if (!record(input)) return undefined
  const su = record(input.step_update) ? input.step_update : undefined
  if (record(su) && su.step_type === "tool") return su
  return undefined
}

function toolNameOf(su: RecordValue): string {
  return typeof su.tool_name === "string" ? su.tool_name : "tool"
}

function toolStepIndex(su: RecordValue): number {
  return typeof su.step_index === "number" ? su.step_index : 0
}

// agy sends the tool call arguments as ``tool_info.parameters``. For tools
// without structured parameters (or events that only carry an output), fall
// back to a flat view so the TUI has something meaningful to show.
function toolInputOf(su: RecordValue): string {
  const info = record(su.tool_info) ? su.tool_info : undefined
  const parameters = record(info?.parameters) ? info.parameters : undefined
  const value = parameters ?? flatFields(info)
  return JSON.stringify(value ?? {})
}

function flatFields(value: RecordValue | undefined): RecordValue | undefined {
  if (!value) return undefined
  const fields = Object.entries(value).filter(
    (entry): entry is [string, string | number | boolean] =>
      typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean",
  )
  return fields.length ? Object.fromEntries(fields.slice(0, 5)) : undefined
}

function toolResultOf(su: RecordValue): string {
  const info = record(su.tool_info) ? su.tool_info : undefined
  if (record(info?.error)) {
    const message = typeof info.error.message === "string" ? info.error.message : ""
    return message || "tool error"
  }
  if (typeof info?.output === "string" && info.output.trim()) return info.output.trim()
  return "done"
}

function textFull(input: unknown): string | undefined {
  if (typeof input === "string") return input
  if (!record(input)) return undefined
  for (const key of ["text", "response", "output", "result", "message", "content"]) {
    const value = input[key]
    if (typeof value === "string") return value
    if (record(value)) {
      const nested = textFull(value)
      if (nested) return nested
    }
  }
  return undefined
}

function prompt(input: unknown) {
  if (!Array.isArray(input)) return String(input)
  return input
    .map((message) => {
      if (!record(message)) return String(message)
      const role = typeof message.role === "string" ? message.role : "unknown"
      const content = Array.isArray(message.content) ? message.content : [message.content]
      const body = content
        .map((part) => {
          if (typeof part === "string") return part
          if (!record(part)) return ""
          if (typeof part.text === "string") return part.text
          if (typeof part.output === "string") return part.output
          if (typeof part.args === "string") return part.args
          if (part.args !== undefined) return JSON.stringify(part.args)
          if (part.result !== undefined) return JSON.stringify(part.result)
          return "[Contenido no textual omitido]"
        })
        .filter(Boolean)
        .join("\n")
      return `<${role}>\n${body}\n</${role}>`
    })
    .join("\n\n")
}

function usage(input: unknown): StreamUsage {
  if (!record(input)) {
    return {
      inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
      raw: undefined,
    } as StreamUsage
  }
  const payload = record(input.result) ? input.result : record(input.step_update) ? input.step_update : input
  const source = record(payload.usage) ? payload.usage : payload
  const number = (key: string) => (typeof source[key] === "number" ? source[key] : undefined)
  const inputTokens = number("input_tokens") ?? number("inputTokens")
  const outputTokens = number("output_tokens") ?? number("outputTokens")
  const cacheRead = number("cache_read_tokens")
  const cacheWrite = number("cache_write_tokens")
  return {
    inputTokens: {
      // agy reports input_tokens separately from cache reads, so input_tokens
      // is already the non-cached portion (rather than a total to subtract from).
      total: inputTokens !== undefined ? inputTokens + (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined,
      noCache: inputTokens,
      cacheRead,
      cacheWrite,
    },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: number("thinking_tokens") ?? number("reasoning_tokens") },
    raw: source,
  } as StreamUsage
}

function metadata(input: unknown, conversationID?: string): SharedV3ProviderMetadata {
  if (!record(input)) return { antigravity: {} }
  const payload = record(input.result) ? input.result : record(input.step_update) ? input.step_update : input
  const source = record(payload.usage) ? payload.usage : payload
  const cost =
    (typeof payload.cost === "number" && Number.isFinite(payload.cost) ? payload.cost : undefined) ??
    (typeof source.cost === "number" && Number.isFinite(source.cost) ? source.cost : undefined)
  return {
    antigravity: {
      usage: source,
      ...(cost === undefined ? {} : { cost }),
      // Native agy conversation id, persisted so a restarted OpenCode can
      // resume the exact Antigravity conversation instead of starting over.
      ...(conversationID === undefined ? {} : { conversation_id: conversationID }),
    },
  } as SharedV3ProviderMetadata
}

type Effort = "low" | "medium" | "high"

function effortOf(value: unknown): Effort | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined
}

// agy CLI models that do not expose reasoning-effort variants. Their ID is
// used verbatim instead of folding an effort suffix into `--model`.
const VARIANTLESS_MODELS = new Set(["claude-sonnet-4-6", "claude-opus-4-6-thinking"])

// Per-request routing metadata OpenCode attaches to providerOptions.antigravity.
// It identifies which native agy conversation a turn belongs to and whether the
// call is the real user conversation or an internal OpenCode task (title,
// summary, compaction, subagents) that must never pollute that conversation.
type AntigravityRequestMeta = {
  readonly sessionID?: string
  readonly messageID?: string
  readonly conversationID?: string
  readonly cwd?: string
  readonly stateDir?: string
  readonly kind: "main" | "internal"
}

function antigravityMeta(streamOptions: Record<string, unknown>): AntigravityRequestMeta {
  const providerOptions = record(streamOptions.providerOptions) ? streamOptions.providerOptions : undefined
  const namespace = record(providerOptions?.antigravity) ? providerOptions.antigravity : undefined
  const meta = record(namespace?.opencode) ? namespace.opencode : undefined
  const sessionID = typeof meta?.sessionID === "string" ? meta.sessionID : undefined
  const messageID = typeof meta?.messageID === "string" ? meta.messageID : undefined
  const conversationID = typeof meta?.conversationID === "string" ? meta.conversationID : undefined
  const cwd = typeof meta?.cwd === "string" ? meta.cwd : undefined
  const stateDir = typeof meta?.stateDir === "string" ? meta.stateDir : undefined
  const kind = meta?.kind === "internal" ? "internal" : "main"
  return { sessionID, messageID, conversationID, cwd, stateDir, kind }
}

// The last user message is the only content that reaches a native agy
// conversation on a continuation turn; agy owns the rest of the history.
function lastUserText(input: unknown): string {
  if (typeof input === "string") return input
  if (!Array.isArray(input)) return ""
  for (let index = input.length - 1; index >= 0; index--) {
    const message = input[index]
    if (!record(message) || message.role !== "user") continue
    const parts = Array.isArray(message.content) ? message.content : [message.content]
    const text = parts
      .map((part) => {
        if (typeof part === "string") return part
        if (!record(part)) return ""
        if (typeof part.text === "string") return part.text
        if (typeof part.output === "string") return part.output
        return ""
      })
      .filter((value) => value !== "")
      .join("\n")
    if (text.trim()) return text
  }
  return ""
}

// agy completes a turn inside its own process even if OpenCode drops the
// stream; retrying the same OpenCode message then re-emits the stored parts
// instead of duplicating the turn inside the native conversation.
type CachedTurn = {
  readonly userID: string
  readonly parts: readonly LanguageModelV3StreamPart[]
  readonly usage: StreamUsage
  readonly metadata: SharedV3ProviderMetadata | undefined
}
const completedTurns = new Map<string, CachedTurn>()

// Build the finish `usage` from per-turn counters when the session engine could
// diff them, and fall back to agy's cumulative counters otherwise.
function turnUsage(summary: { countersDelta?: Record<string, number>; event: Record<string, unknown> }): StreamUsage {
  if (summary.countersDelta === undefined) return usage(summary.event)
  return usage({ event: "result", result: { usage: summary.countersDelta } })
}

export function createLanguageModel(modelID: string, options: Record<string, unknown>): LanguageModelV3 {
  // agy bakes the reasoning effort into the model name for Gemini-family
  // models; variants switch the effort. Prefer the per-request
  // providerOptions (V1 variants, keyed under providerOptions.antigravity),
  // then the explicit option (V2 catalog settings), then the ID suffix (legacy
  // models), then the default. Claude and GPT-OSS models use the ID verbatim.
  const providerOptions = record(options.providerOptions) ? options.providerOptions : undefined
  const variant = record(providerOptions?.antigravity) ? providerOptions.antigravity : undefined
  const suffix = effortOf(modelID.split("-").at(-1))
  const effort = effortOf(variant?.effort) ?? effortOf(options.effort) ?? suffix ?? "low"
  // The CLI model name is `<id>-<effort>`; keep suffixed IDs as-is so older
  // sessions and direct catalog models still map to a concrete CLI model.
  const agyModelIDValue = suffix
    ? modelID
    : VARIANTLESS_MODELS.has(modelID)
      ? modelID
      : `${modelID}-${effort}`

  const doStream = async (options: Parameters<LanguageModelV3["doStream"]>[0]) => {
    const meta = antigravityMeta(options)
    const persistent = meta.sessionID !== undefined && meta.kind === "main"
    // A retry of the exact OpenCode message agy already answered re-emits the
    // stored stream instead of duplicating the turn in the native conversation.
    const replay =
      persistent && meta.messageID !== undefined && completedTurns.get(meta.sessionID!)?.userID === meta.messageID
    const cwd = meta.cwd ?? process.cwd()
    let cancelled = false
    let conversation: AgyConversation | undefined
    let child: ReturnType<typeof spawnChild> | undefined

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] })
        if (replay) {
          const cached = completedTurns.get(meta.sessionID!)!
          for (const part of cached.parts) controller.enqueue(part)
          controller.enqueue({
            type: "finish",
            usage: cached.usage,
            finishReason: { unified: "stop", raw: "agy" },
            providerMetadata: cached.metadata,
          })
          controller.close()
          return
        }

        // Defer text-start until the first text delta. agy interleaves tool
        // calls before the final answer; opening the text part up front would
        // store it before the tool parts, so the TUI renders the answer above
        // the tools. Other providers open text last, keeping tools on top.
        let textStarted = false
        const startText = () => {
          if (textStarted) return
          textStarted = true
          emit({ type: "text-start", id: "antigravity" })
        }
        // agy stays silent while it reasons (~5s warmup) before the first text
        // delta. The TUI renders an opaque "Thinking…" block while this part is
        // open (empty body + providerMetadata), giving feedback that the model
        // is working. No fabricated reasoning text is emitted.
        const reasoningID = "antigravity-thought"
        let thinking = true
        const endThinking = () => {
          if (!thinking) return
          thinking = false
          emit({ type: "reasoning-end", id: reasoningID })
        }
        let sent = ""
        let lastEvent: unknown
        let cliError: string | undefined
        // agy executes tools inside its own loop; mirror each step as a native
        // provider-executed tool call so the TUI renders them like real tools.
        const toolCalls = new Map<string, string>()
        // Persistent main turns record their emitted parts so an exact retry of
        // the same message can replay them without touching agy again.
        const capturing = persistent
        const captured: LanguageModelV3StreamPart[] = []
        const emit = (part: LanguageModelV3StreamPart) => {
          try {
            controller.enqueue(part)
          } catch {}
          if (capturing && part.type !== "stream-start" && part.type !== "error" && part.type !== "finish")
            captured.push(part)
        }
        let closed = false
        const closeStream = () => {
          if (closed) return
          closed = true
          try {
            controller.close()
          } catch {}
        }
        emit({
          type: "reasoning-start",
          id: reasoningID,
          providerMetadata: { antigravity: { phase: "thinking" } },
        })

        const processEvent = (event: unknown) => {
          if (!record(event)) return
          lastEvent = event
          if (record(event.result) && typeof event.result.error === "string") cliError = event.result.error
          const tool = toolStep(event)
          if (tool) {
            endThinking()
            const id = `agy-tool-${toolStepIndex(tool)}`
            const toolName = toolNameOf(tool)
            const state = typeof tool.state === "string" ? tool.state : "ACTIVE"
            if (!toolCalls.has(id)) {
              emit({
                type: "tool-call",
                toolCallId: id,
                toolName,
                input: toolInputOf(tool),
                // agy's tool registry is not declared in opencode's streamText
                // toolset; dynamic + providerExecuted lets the AI SDK pass these
                // through as opaque executed tools.
                dynamic: true,
                providerExecuted: true,
              })
              toolCalls.set(id, toolName)
            }
            if (state === "DONE" || state === "ERROR") {
              emit({
                type: "tool-result",
                toolCallId: id,
                toolName,
                result: toolResultOf(tool),
                ...(state === "ERROR" ? { isError: true } : {}),
              })
              toolCalls.delete(id)
            }
            return
          }
          const delta = textDelta(event)
          if (delta) {
            endThinking()
            startText()
            emit({ type: "text-delta", id: "antigravity", delta })
            sent += delta
            return
          }
          const fallback = textFull(event)
          if (!fallback) return
          const value = fallback.startsWith(sent) ? fallback.slice(sent.length) : fallback
          sent += value
          if (value) {
            endThinking()
            startText()
            emit({ type: "text-delta", id: "antigravity", delta: value })
          }
        }

        const flushLeftover = (event: unknown) => {
          const value = textFull(event)
          if (!value) return
          const delta = value.startsWith(sent) ? value.slice(sent.length) : value
          sent += delta
          if (delta) {
            endThinking()
            startText()
            emit({ type: "text-delta", id: "antigravity", delta })
          }
        }

        const run = async () => {
          try {
            if (persistent) {
              const sessionID = meta.sessionID!
              conversation = await acquireAgyConversation({
                key: sessionID,
                binary: AGY,
                cwd,
                model: agyModelIDValue,
                // Variantless models (Claude) have no reasoning-effort knob.
                effort: VARIANTLESS_MODELS.has(modelID) ? undefined : effort,
                alwaysProceed: true,
                conversationID: meta.conversationID,
                stateDir: meta.stateDir,
              })
              const abort = () => {
                cancelled = true
                conversation?.cancelActive()
              }
              options.abortSignal?.addEventListener("abort", abort, { once: true })
              const text = lastUserText(options.prompt)
              const summary = await conversation.turn({
                text,
                onEvent: (event) => {
                  if (!cancelled) processEvent(event)
                },
              })
              options.abortSignal?.removeEventListener("abort", abort)
              if (cancelled || summary.dropped) {
                closeStream()
                return
              }
              flushLeftover(summary.event)
              const usageValue = turnUsage(summary)
              const metaValue = metadata(summary.event, summary.conversationID || undefined)
              endThinking()
              if (textStarted) emit({ type: "text-end", id: "antigravity" })
              controller.enqueue({
                type: "finish",
                usage: usageValue,
                finishReason: { unified: "stop", raw: "agy" },
                providerMetadata: metaValue,
              })
              if (meta.messageID !== undefined) {
                completedTurns.set(sessionID, {
                  userID: meta.messageID,
                  parts: captured,
                  usage: usageValue,
                  metadata: metaValue,
                })
              }
              closeStream()
              return
            }

            // Single-shot ephemeral process: OpenCode-internal tasks (title,
            // summary, compaction, subagents) never touch the user's native agy
            // conversation. Same structured protocol as before, but the full
            // OpenCode transcript is replayed into a throwaway conversation.
            child = spawnChild(
              AGY,
              [
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--model",
                agyModelIDValue,
                // Variantless models (Claude) have no reasoning-effort knob.
                ...(VARIANTLESS_MODELS.has(modelID) ? [] : ["--effort", effort]),
                "--dangerously-skip-permissions",
                "--print=",
              ],
              { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
            )
            if (!child.stdin || !child.stdout || !child.stderr) throw new Error("Could not create agy streams")
            const abort = () => {
              cancelled = true
              child?.kill()
            }
            options.abortSignal?.addEventListener("abort", abort, { once: true })
            const payload = JSON.stringify({ event: "user", message: { content: prompt(options.prompt) } })
            child.stdin.write(payload + "\n")
            child.stdin.end()

            let processOutput = ""
            let processError = ""
            child.stdout.setEncoding("utf8")
            child.stdout.on("data", (chunk: string) => {
              processOutput += chunk
              const lines = processOutput.split(/\r?\n/)
              processOutput = lines.pop() ?? ""
              for (const line of lines) {
                try {
                  processEvent(JSON.parse(line) as unknown)
                } catch {}
              }
            })
            child.stderr.setEncoding("utf8")
            child.stderr.on("data", (chunk: string) => {
              processError += chunk
            })
            const exitCode = await new Promise<number>((resolve, reject) => {
              child!.once("error", reject)
              child!.once("exit", (code) => resolve(code ?? 1))
            })
            options.abortSignal?.removeEventListener("abort", abort)
            if (cancelled) {
              closeStream()
              return
            }
            if (exitCode !== 0) throw new Error(cliError || processError.trim() || `agy exited with code ${exitCode}`)
            if (processOutput.trim()) {
              try {
                processEvent(JSON.parse(processOutput) as unknown)
              } catch {}
            }
            endThinking()
            if (textStarted) emit({ type: "text-end", id: "antigravity" })
            controller.enqueue({
              type: "finish",
              usage: usage(lastEvent),
              finishReason: { unified: "stop", raw: "agy" },
              providerMetadata: metadata(lastEvent),
            })
            closeStream()
          } catch (error) {
            if (!cancelled) {
              endThinking()
              controller.enqueue({ type: "error", error })
            }
            closeStream()
          }
        }
        void run()
      },
      cancel() {
        cancelled = true
        conversation?.cancelActive()
        try {
          child?.kill()
        } catch {}
      },
    })
    return { stream }
  }

  return {
    specificationVersion: "v3",
    provider: "antigravity",
    modelId: modelID,
    supportedUrls: {},
    async doGenerate(options: Parameters<LanguageModelV3["doGenerate"]>[0]) {
      const result = await doStream(options)
      const reader = result.stream.getReader()
      let value = ""
      let finalUsage = usage(undefined)
      let finalMetadata: SharedV3ProviderMetadata | undefined
      while (true) {
        const next = await reader.read()
        if (next.done) break
        if (next.value.type === "text-delta") value += next.value.delta
        if (next.value.type === "finish") {
          finalUsage = next.value.usage
          finalMetadata = next.value.providerMetadata
        }
      }
      return {
        content: value ? [{ type: "text", text: value }] : [],
        finishReason: { unified: "stop", raw: "agy" },
        usage: finalUsage,
        warnings: [],
        providerMetadata: finalMetadata,
        request: { body: { model: agyModelIDValue, effort } },
        response: { headers: {} },
      }
    },
    doStream,
  } as LanguageModelV3
}

export type AgyUsageBucket = {
  readonly id?: string
  readonly name: string
  readonly window: string
  readonly remaining_fraction: number
  readonly reset_time?: string
}

export type AgyUsageGroup = {
  readonly name: string
  readonly description: string
  readonly buckets: readonly AgyUsageBucket[]
}

// Quota refreshes slowly and agy takes a few seconds to boot, so cache the
// result briefly and coalesce concurrent callers. The startup latency would
// otherwise leave the usage dialog stuck on a loading state for every open.
let usageCache: { at: number; groups: AgyUsageGroup[] } | undefined
let usageInFlight: Promise<AgyUsageGroup[]> | undefined

export async function getAgyUsage(force = false): Promise<AgyUsageGroup[]> {
  if (!force && usageCache && Date.now() - usageCache.at < 60_000) return usageCache.groups
  if (!usageInFlight) {
    usageInFlight = fetchAgyUsage()
      .then((groups) => {
        usageCache = { at: Date.now(), groups }
        return groups
      })
      .finally(() => {
        usageInFlight = undefined
      })
  }
  return usageInFlight
}

async function fetchAgyUsage(): Promise<AgyUsageGroup[]> {
  let result: { raw: string; errOutput: string; exitCode: number }
  try {
    result = await runAgy([AGY, "--print", "/usage", "--output-format", "json"])
  } catch (cause) {
    // Direct spawn failed (not on PATH, or the process hung). Fall back to the
    // shell, which resolves agy through the user's logged-in environment. The
    // TUI process has a narrower PATH/console than an interactive shell.
    if (process.platform !== "win32") throw cause
    result = await runAgy(["cmd", "/d", "/c", "agy --print /usage --output-format json"])
  }
  if (result.exitCode !== 0) throw new Error(result.errOutput || `agy exited with code ${result.exitCode}`)
  const payload = JSON.parse(result.raw || "null") as unknown
  if (!record(payload) || payload.status !== "SUCCESS") {
    throw new Error(record(payload) && typeof payload.message === "string" ? payload.message : "Could not fetch Antigravity usage")
  }
  const command = record(payload.command) ? payload.command : undefined
  const data = command && record(command.data) ? command.data : undefined
  const groups = data && Array.isArray(data.groups) ? (data.groups as unknown[]) : []
  return groups.flatMap((group): AgyUsageGroup[] => {
    if (!record(group) || typeof group.name !== "string") return []
    const buckets = Array.isArray(group.buckets) ? group.buckets : []
    return [
      {
        name: group.name,
        description: typeof group.description === "string" ? group.description : "",
        buckets: buckets.flatMap((bucket): AgyUsageBucket[] => {
          if (!record(bucket) || typeof bucket.name !== "string" || typeof bucket.remaining_fraction !== "number") return []
          return [
            {
              id: typeof bucket.id === "string" ? bucket.id : undefined,
              name: bucket.name,
              window: typeof bucket.window === "string" ? bucket.window : "",
              remaining_fraction: bucket.remaining_fraction,
              reset_time: typeof bucket.reset_time === "string" ? bucket.reset_time : undefined,
            },
          ]
        }),
      },
    ]
  })
}

async function runAgy(args: readonly string[]): Promise<{ raw: string; errOutput: string; exitCode: number }> {
  // The TUI runs under Bun. Bun's native subprocess handle exposes an
  // `exited` promise that remains reliable while OpenTUI owns the terminal;
  // node:child_process exit/close events can otherwise be lost there after
  // agy has already terminated, leaving /usage spinning forever.
  if (typeof Bun !== "undefined") {
    const child = Bun.spawn([...args], {
      cwd: process.cwd(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    })
    const timer = setTimeout(() => child.kill(), 20_000)
    try {
      const [raw, errOutput, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      return { raw: raw.trim(), errOutput: errOutput.trim(), exitCode }
    } finally {
      clearTimeout(timer)
    }
  }

  const response: string[] = []
  const errorOutput: string[] = []
  const child = spawnChild(args[0], [...args.slice(1)], {
    cwd: process.cwd(),
    // Usage is a one-shot command and never reads stdin. Ignore it entirely
    // so the TUI cannot leave agy waiting for an EOF from an inherited pipe.
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  if (!child.stdout || !child.stderr) throw new Error("Could not create agy streams")
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => response.push(chunk))
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => errorOutput.push(chunk))
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error("agy timed out"))
    }, 20_000)
    let settled = false
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(code ?? 1)
    }
    child.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    // Node normally emits `exit` first, but Bun on Windows can only deliver
    // `close` after the redirected streams drain. Listen to both so the TUI
    // never waits forever after agy has already terminated.
    child.once("exit", finish)
    child.once("close", finish)
  })
  return { raw: response.join("").trim(), errOutput: errorOutput.join("").trim(), exitCode }
}

export type AgyMcpServer =
  | { type: "stdio"; name: string; command: readonly string[]; environment?: Record<string, string> }
  | { type: "http"; name: string; url: string; headers?: Record<string, string> }

// agy executes MCP servers in its own tool loop, so opencode-registered MCP
// servers (e.g. engram) need to exist in agy's config to be runnable. `mcp add`
// is idempotent ("Add or update"), so re-adding the enabled servers is enough;
// no parsing of `agy mcp list` is needed.
let agyMcpSyncedAt = 0
const AGY_MCP_SYNC_INTERVAL_MS = 10 * 60_000

export async function syncAgyMcpServers(
  servers: readonly AgyMcpServer[],
  force = false,
): Promise<{ ok: number; failed: number }> {
  const summary = { ok: 0, failed: 0 }
  if (servers.length === 0) return summary
  if (!force && Date.now() - agyMcpSyncedAt < AGY_MCP_SYNC_INTERVAL_MS) return summary

  for (const server of servers) {
    const args = ["mcp", "add"]
    if (server.type === "stdio") {
      for (const [key, value] of Object.entries(server.environment ?? {})) args.push("--env", `${key}=${value}`)
      if (server.command.length === 0) continue
      args.push(server.name)
      // agy rejects a command starting with "-" unless it follows "--".
      if (server.command[0].startsWith("-")) args.push("--")
      args.push(...server.command)
    } else {
      for (const [key, value] of Object.entries(server.headers ?? {})) args.push("--header", `${key}: ${value}`)
      args.push("--type", "http", server.name, server.url)
    }
    try {
      const result = await runAgy([AGY, ...args])
      if (result.exitCode === 0) summary.ok++
      else summary.failed++
    } catch {
      summary.failed++
    }
  }

  agyMcpSyncedAt = Date.now()
  return summary
}

export async function beginOAuth(): Promise<OAuthSession> {
  const { spawn } = await import("#pty")
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
  env.AGY_CLI_HIDE_LOGO = "true"
  // Make agy expose its code flow instead of opening a competing browser tab.
  // OpenCode opens the returned URL from the connect dialog itself.
  env.SSH_CONNECTION ??= "127.0.0.1 0 127.0.0.1 0"
  const pty = spawn(AGY, ["--output-format", "stream-json", "--print=/model"], {
    name: "xterm-256color",
    cols: 120,
    rows: 32,
    cwd: process.cwd(),
    env,
  })
  const output: string[] = []
  let data: Disp | undefined
  let exited: Disp | undefined
  let resolveExit: (() => void) | undefined
  let rejectExit: ((error: Error) => void) | undefined
  const complete = new Promise<void>((resolve, reject) => {
    resolveExit = resolve
    rejectExit = reject
  })
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("agy did not provide an OAuth authorization URL")), 15_000)
    data = pty.onData((chunk) => {
      output.push(chunk)
      const value = output.join("").match(AUTHORIZATION_URL)?.[0]
      if (!value) return
      clearTimeout(timeout)
      const parsed = new URL(value)
      if (parsed.protocol !== "https:" || parsed.hostname !== "accounts.google.com") {
        reject(new Error("agy returned an unsafe OAuth authorization URL"))
        return
      }
      resolve(parsed.href)
    })
    exited = pty.onExit(({ exitCode }) => {
      const message = output.join("").trim() || `agy exited with code ${exitCode}`
      reject(new Error(message))
      if (exitCode === 0) resolveExit?.()
      else rejectExit?.(new Error(message))
    })
  })
  return {
    url,
    async complete(code) {
      const value = code.trim()
      if (!value || /[\r\n]/.test(value)) throw new Error("Invalid Antigravity authorization code")
      pty.write(value + "\r")
      await complete
    },
    stop() {
      data?.dispose()
      exited?.dispose()
      try {
        pty.kill()
      } catch {}
    },
  }
}
