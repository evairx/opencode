import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { LanguageModelV3, LanguageModelV3StreamPart, SharedV3ProviderMetadata } from "@ai-sdk/provider"
import type { AgyUsageBucket, AgyUsageGroup } from "./antigravity"
import { Global } from "./global"

// ============================================================
// Claude (Anthropic / Claude Code) provider
//
// Supports authentication via:
// 1. Claude Code CLI (claude.exe) driving subscription directly
// 2. Claude Code OAuth token (CLAUDE_CODE_OAUTH_TOKEN / `claude setup-token`)
// 3. Claude Code credentials file (~/.claude/.credentials.json or ~/.claude.json)
// 4. Stored OpenCode auth (data/auth.json -> claude)
//
// Usage and quotas (5h rolling window & weekly quota) are fetched from
// local Claude CLI (`claude -p /usage`) or `claude.ai/api/usage`.
// Quota displays consistently with Codex and Antigravity (100% -> 0% remaining).
// ============================================================

export const CLAUDE_BASE_URL = "https://api.anthropic.com"
export const CLAUDE_WEB_BASE_URL = "https://claude.ai"
export const CLAUDE_USAGE_BASE_URL = "https://claude.ai/api"
export const CLAUDE_DEFAULT_ORG_URL = `${CLAUDE_USAGE_BASE_URL}/organizations`

export interface ClaudeStoredAuth {
  type?: string
  access?: string
  token?: string
  key?: string
  orgId?: string
  accountId?: string
  expires?: number
}

const authFilePath = () => path.join(Global.Path.data, "auth.json")

function normalizeAuthEntry(entry: unknown): ClaudeStoredAuth | undefined {
  if (!entry || typeof entry !== "object") return undefined
  const e = entry as Record<string, unknown>
  const token = stringVal(e.access) ?? stringVal(e.token) ?? stringVal(e.key)
  if (!token) return undefined
  return {
    type: token.startsWith("sk-ant-oat") ? "oauth" : (stringVal(e.type) ?? "api"),
    access: token,
    token,
    key: token,
    orgId: stringVal(e.orgId) ?? stringVal(e.org_id),
    accountId: stringVal(e.accountId) ?? stringVal(e.account_id),
    expires: typeof e.expires === "number" ? e.expires : undefined,
  }
}

/**
 * Locate and read stored Claude Code credentials from disk or environment.
 */
export async function readStoredClaudeAuth(): Promise<ClaudeStoredAuth | undefined> {
  // 1. Check environment variable
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY
  if (envToken) {
    return {
      type: envToken.startsWith("sk-ant-oat") ? "oauth" : "api",
      access: envToken,
      token: envToken,
      key: envToken,
      orgId: process.env.CLAUDE_ORG_ID,
    }
  }

  // 2. Check OpenCode auth content env
  if (process.env.OPENCODE_AUTH_CONTENT) {
    try {
      const data = JSON.parse(process.env.OPENCODE_AUTH_CONTENT) as Record<string, unknown>
      const parsed = normalizeAuthEntry(data["claude"])
      if (parsed) return parsed
    } catch {}
  }

  // 3. Check OpenCode data/auth.json
  try {
    const raw = await readFile(authFilePath(), "utf8")
    const data = JSON.parse(raw) as Record<string, unknown>
    const parsed = normalizeAuthEntry(data["claude"])
    if (parsed) return parsed
  } catch {}

  // 4. Check Claude Code CLI configuration files (~/.claude/.credentials.json or ~/.claude.json)
  const credentialsPath =
    process.env.CLAUDE_AUTH_JSON_PATH ??
    (process.env.CLAUDE_CONFIG_DIR
      ? path.join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json")
      : path.join(homedir(), ".claude", ".credentials.json"))

  let result: ClaudeStoredAuth | undefined

  if (existsSync(credentialsPath)) {
    try {
      const raw = readFileSync(credentialsPath, "utf8")
      const data = JSON.parse(raw) as Record<string, unknown>
      result = extractTokenFromClaudeJson(data)
    } catch {}
  }

  const legacyClaudeJson = process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, "config.json")
    : path.join(homedir(), ".claude.json")

  if (existsSync(legacyClaudeJson)) {
    try {
      const raw = readFileSync(legacyClaudeJson, "utf8")
      const data = JSON.parse(raw) as Record<string, unknown>
      const parsed = extractTokenFromClaudeJson(data)
      if (parsed) {
        result = { ...parsed, ...(result ?? {}) }
      }
      if (data.oauthAccount && typeof data.oauthAccount === "object") {
        const acc = data.oauthAccount as Record<string, unknown>
        const orgId = stringVal(acc.organizationUuid) ?? stringVal(acc.organizationId)
        if (orgId) {
          result = { ...(result ?? {}), orgId, accountId: stringVal(acc.accountUuid) }
        }
      }
    } catch {}
  }

  if (result) return result

  return undefined
}

function extractTokenFromClaudeJson(data: Record<string, unknown>): ClaudeStoredAuth | undefined {
  // Structure 0: { claudeAiOauth: { accessToken, refreshToken, expiresAt, ... } } (Claude Code CLI)
  if (data.claudeAiOauth && typeof data.claudeAiOauth === "object") {
    const o = data.claudeAiOauth as Record<string, unknown>
    const token = stringVal(o.accessToken) ?? stringVal(o.access_token)
    if (token) {
      return {
        type: "oauth",
        access: token,
        token,
        key: token,
        expires: typeof o.expiresAt === "number" ? o.expiresAt : undefined,
      }
    }
  }

  // Structure 1: { session: { token, orgId, accountId } }
  if (data.session && typeof data.session === "object") {
    const s = data.session as Record<string, unknown>
    const token = stringVal(s.token) ?? stringVal(s.accessToken) ?? stringVal(s.access_token)
    if (token) {
      return {
        type: token.startsWith("sk-ant-oat") ? "oauth" : "api",
        access: token,
        token,
        key: token,
        orgId: stringVal(s.orgId) ?? stringVal(s.org_id) ?? stringVal(data.orgId),
        accountId: stringVal(s.accountId) ?? stringVal(s.account_id),
      }
    }
  }

  // Structure 2: { oauthToken, orgId }
  const oauthToken = stringVal(data.oauthToken) ?? stringVal(data.oauth_token) ?? stringVal(data.token)
  if (oauthToken) {
    return {
      type: oauthToken.startsWith("sk-ant-oat") ? "oauth" : "api",
      access: oauthToken,
      token: oauthToken,
      key: oauthToken,
      orgId: stringVal(data.orgId) ?? stringVal(data.org_id),
    }
  }

  // Structure 3: { primaryApiKey } or { apiKey }
  const apiKey = stringVal(data.primaryApiKey) ?? stringVal(data.apiKey) ?? stringVal(data.customApiKey)
  if (apiKey) {
    return {
      type: "api",
      access: apiKey,
      token: apiKey,
      key: apiKey,
      orgId: stringVal(data.orgId),
    }
  }

  return undefined
}

function stringVal(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

export async function writeStoredClaudeAuth(update: ClaudeStoredAuth): Promise<void> {
  try {
    const existing = await readStoredClaudeAuth()
    const merged = { ...(existing ?? {}), ...update }
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(await readFile(authFilePath(), "utf8")) as Record<string, unknown>
    } catch {}
    data["claude"] = merged
    await writeFile(authFilePath(), JSON.stringify(data, null, 2), { mode: 0o600 })
  } catch {}
}

// ============================================================
// Models
// ============================================================

export interface ClaudeModel {
  id: string
  name: string
  family?: string
  context: number
  input?: number
  output?: number
  /** USD per 1M tokens, used by OpenCode to estimate cost. */
  price: { input: number; output: number; cache?: { read: number; write: number; write1h?: number } }
  variants?: readonly string[]
}

export const CLAUDE_PRICING_URL = "https://platform.claude.com/docs/en/about-claude/pricing"

export const CLAUDE_MODELS: ClaudeModel[] = [
  {
    id: "claude-fable-5-1",
    name: "Claude Fable 5.1",
    family: "claude",
    context: 200_000,
    input: 200_000,
    output: 64_000,
    price: { input: 10, output: 50, cache: { read: 0.25, write: 12.5, write1h: 20 } },
    variants: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    family: "claude",
    context: 200_000,
    input: 200_000,
    output: 64_000,
    price: { input: 4, output: 20, cache: { read: 0.2, write: 5, write1h: 8 } },
    variants: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    family: "claude",
    context: 200_000,
    input: 200_000,
    output: 64_000,
    price: { input: 2, output: 10, cache: { read: 0.2, write: 2.5, write1h: 4 } },
    variants: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    family: "claude",
    context: 200_000,
    input: 200_000,
    output: 64_000,
    price: { input: 1, output: 5, cache: { read: 0.1, write: 1.25, write1h: 2 } },
    variants: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    family: "claude",
    context: 200_000,
    input: 200_000,
    output: 64_000,
    price: { input: 10, output: 50, cache: { read: 1, write: 12.5, write1h: 20 } },
    variants: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    family: "claude",
    context: 200_000,
    input: 200_000,
    output: 64_000,
    price: { input: 5, output: 25, cache: { read: 0.5, write: 6.25, write1h: 10 } },
    variants: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    family: "claude",
    context: 200_000,
    input: 200_000,
    output: 64_000,
    price: { input: 5, output: 25, cache: { read: 0.5, write: 6.25, write1h: 10 } },
    variants: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    family: "claude",
    context: 200_000,
    input: 200_000,
    output: 64_000,
    price: { input: 5, output: 25, cache: { read: 0.5, write: 6.25, write1h: 10 } },
    variants: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    family: "claude",
    context: 200_000,
    input: 200_000,
    output: 64_000,
    price: { input: 5, output: 25, cache: { read: 0.5, write: 6.25, write1h: 10 } },
    variants: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    family: "claude",
    context: 200_000,
    input: 200_000,
    output: 64_000,
    price: { input: 2, output: 10, cache: { read: 0.2, write: 2.5, write1h: 4 } },
    variants: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    family: "claude",
    context: 200_000,
    input: 200_000,
    output: 64_000,
    price: { input: 3, output: 15, cache: { read: 0.3, write: 3.75, write1h: 6 } },
    variants: ["low", "medium", "high", "xhigh", "max"],
  },
]

/** Model IDs allowed in the OpenCode Claude provider model selector. */
export const CLAUDE_ALLOWED_IDS = new Set([
  "claude-sonnet-4-6", "claude-sonnet-5", "claude-sonnet-5-5",
  "claude-fable-5", "claude-fable-5-1",
  "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-opus-5-5",
  "claude-haiku-4-5",
])

export function modelNameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function parseClaudePricingHtml(html: string): ClaudeModel[] {
  let proseBlock = html
  const proseMatch = html.match(/<div[^>]*data-cds="Prose"[^>]*>([\s\S]*?)<\/div>/i)
  if (proseMatch) {
    proseBlock = proseMatch[0]
  }

  const tableMatch = proseBlock.match(/<table[\s\S]*?<\/table>/i) || html.match(/<table[\s\S]*?<\/table>/i)
  if (!tableMatch) return []

  const tableHtml = tableMatch[0]
  const rows = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
  const models: ClaudeModel[] = []

  const parseNumber = (val: string): number => {
    const clean = val.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").trim()
    const match = clean.match(/\$([0-9.]+)/)
    return match ? parseFloat(match[1]) : 0
  }

  for (const rowMatch of rows) {
    const row = rowMatch[0]
    const cells = [...row.matchAll(/<td[\s\S]*?<\/td>/gi)].map((c) => c[0])
    if (cells.length < 6) continue

    let rawName = ""
    const linkMatch = cells[0].match(/<a[^>]*>([^<]+)<\/a>/i)
    const boldMatch = cells[0].match(/class="[^"]*font-medium[^"]*"[^>]*>([^<]+)</i)

    if (linkMatch) {
      rawName = linkMatch[1]
    } else if (boldMatch) {
      rawName = boldMatch[1]
    } else {
      const text = cells[0].replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      rawName = text.split("For ")[0].trim()
    }

    const cleanName = rawName.replace(/[\uE000-\uF8FF]/g, "").trim()
    if (!cleanName || !cleanName.toLowerCase().includes("claude")) continue

    const id = modelNameToId(cleanName)

    // Only include models from the allowed list for the OpenCode model selector
    if (!CLAUDE_ALLOWED_IDS.has(id)) continue

    const inputPrice = parseNumber(cells[1])
    const outputPrice = parseNumber(cells[2])
    const cache5m = parseNumber(cells[3])
    const cache1h = parseNumber(cells[4])
    const cacheRead = parseNumber(cells[5])

    models.push({
      id,
      name: cleanName,
      family: "claude",
      context: 200_000,
      input: 200_000,
      output: 64_000,
      price: {
        input: inputPrice,
        output: outputPrice,
        cache: {
          read: cacheRead,
          write: cache5m,
          write1h: cache1h,
        },
      },
      variants: ["low", "medium", "high", "xhigh", "max"],
    })
  }

  return models
}

export async function scrapeClaudePricing(timeoutMs = 10_000): Promise<ClaudeModel[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(CLAUDE_PRICING_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    return parseClaudePricingHtml(html)
  } finally {
    clearTimeout(timer)
  }
}

let memoryCache: ClaudeModel[] | undefined

export function loadCachedClaudeModels(): { models: ClaudeModel[]; isFresh: boolean } | undefined {
  if (memoryCache && memoryCache.length > 0) {
    return { models: memoryCache, isFresh: true }
  }
  try {
    const file = path.join(Global.Path.cache, "claude-models.json")
    if (!existsSync(file)) return undefined
    const content = readFileSync(file, "utf8")
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed) && parsed.length > 0) {
      memoryCache = parsed
      return { models: parsed, isFresh: false }
    }
    if (parsed && Array.isArray(parsed.models) && parsed.models.length > 0) {
      memoryCache = parsed.models
      const isFresh = Date.now() - (parsed.updatedAt || 0) < 1000 * 60 * 60 * 2
      return { models: parsed.models, isFresh }
    }
  } catch {}
  return undefined
}

export function saveCachedClaudeModels(models: ClaudeModel[]): void {
  try {
    memoryCache = models
    const file = path.join(Global.Path.cache, "claude-models.json")
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ updatedAt: Date.now(), models }, null, 2), "utf8")
  } catch {}
}

export function getClaudeModels(): ClaudeModel[] {
  const cached = loadCachedClaudeModels()
  if (cached?.models && cached.models.length > 0) return cached.models
  return CLAUDE_MODELS
}

export async function fetchLiveClaudeModels(): Promise<ClaudeModel[]> {
  // 1. Try scraping official Claude pricing documentation
  try {
    const scraped = await scrapeClaudePricing()
    if (scraped.length > 0) return scraped
  } catch {}

  // 2. Fallback to models.dev
  try {
    const res = await fetch("https://models.dev/api.json", {
      headers: { "User-Agent": "opencode" },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as Record<string, any>
    const anthropic = data["anthropic"]
    if (!anthropic?.models) return CLAUDE_MODELS

    const results: ClaudeModel[] = []
    for (const [id, m] of Object.entries(anthropic.models as Record<string, any>)) {
      if (!id.startsWith("claude-")) continue
      results.push({
        id,
        name: m.name || id,
        family: m.family || "claude",
        context: m.limit?.context || 200_000,
        input: m.limit?.context || 200_000,
        output: m.limit?.output || 64_000,
        price: {
          input: m.cost?.input ?? 3,
          output: m.cost?.output ?? 15,
          cache: {
            read: m.cost?.cache_read ?? 0.3,
            write: m.cost?.cache_write ?? 3.75,
          },
        },
        variants: m.reasoning_options?.[0]?.values ?? ["low", "medium", "high", "xhigh", "max"],
      })
    }
    if (results.length > 0) return results
  } catch {}

  return CLAUDE_MODELS
}

export async function refreshClaudeModels(): Promise<ClaudeModel[]> {
  const cached = loadCachedClaudeModels()
  if (cached?.isFresh) return cached.models
  const live = await fetchLiveClaudeModels()
  if (live.length > 0) {
    saveCachedClaudeModels(live)
    return live
  }
  saveCachedClaudeModels(CLAUDE_MODELS)
  return CLAUDE_MODELS
}

// ============================================================
// Usage & Quotas (5-Hour Window & Weekly Rolling Quota)
// ============================================================

let usageCache: { at: number; groups: AgyUsageGroup[] } | undefined
let usageInFlight: Promise<AgyUsageGroup[]> | undefined

export async function getClaudeUsage(force = false): Promise<AgyUsageGroup[]> {
  if (!force && usageCache && Date.now() - usageCache.at < 60_000) return usageCache.groups
  if (!usageInFlight) {
    usageInFlight = fetchClaudeUsage()
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

export function resolveClaudeBinary(): string {
  if (process.env.CLAUDE_PATH && existsSync(process.env.CLAUDE_PATH)) {
    return process.env.CLAUDE_PATH
  }
  const defaultBin = process.platform === "win32" ? "claude.exe" : "claude"
  const localBin = path.join(homedir(), ".local", "bin", defaultBin)
  if (existsSync(localBin)) return localBin
  return defaultBin
}

export const CLAUDE_BIN = process.platform === "win32" ? "claude.exe" : "claude"

export async function runClaude(args: readonly string[]): Promise<{ raw: string; errOutput: string; exitCode: number }> {
  const binary = resolveClaudeBinary()
  const fullArgs = [binary, ...args.slice(1)]

  if (typeof Bun !== "undefined") {
    const child = Bun.spawn(fullArgs, {
      cwd: process.cwd(),
      stdin: new Uint8Array(0),
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    })
    const timer = setTimeout(() => child.kill(), 15_000)
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

  const { spawn: spawnChild } = await import("node:child_process")
  const response: string[] = []
  const errorOutput: string[] = []
  const child = spawnChild(fullArgs[0], [...fullArgs.slice(1)], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  if (!child.stdout || !child.stderr || !child.stdin) throw new Error("Could not create claude streams")
  child.stdin.end()
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => response.push(chunk))
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => errorOutput.push(chunk))
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error("claude timed out"))
    }, 15_000)
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
    child.once("exit", finish)
    child.once("close", finish)
  })
  return { raw: response.join("").trim(), errOutput: errorOutput.join("").trim(), exitCode }
}

async function fetchClaudeUsage(): Promise<AgyUsageGroup[]> {
  // First attempt: query local claude CLI in print mode, which returns live quota
  // without encountering Cloudflare challenges.
  try {
    const result = await runClaude([CLAUDE_BIN, "-p", "/usage", "--output-format", "json"])
    if (result.exitCode === 0 && result.raw) {
      const jsonStart = result.raw.indexOf("{")
      const jsonStr = jsonStart !== -1 ? result.raw.slice(jsonStart) : result.raw
      const payload = JSON.parse(jsonStr) as { result?: string }
      if (typeof payload?.result === "string") {
        const text = payload.result
        const sessionMatch = text.match(/Current session:\s*(\d+(?:\.\d+)?)%\s*used(?:[^\n·]*·\s*resets\s*([^\n]+))?/i)
        const weekMatch = text.match(/Current week(?:\s*\([^)]*\))?:\s*(\d+(?:\.\d+)?)%\s*used(?:[^\n·]*·\s*resets\s*([^\n]+))?/i)
        const buckets: AgyUsageBucket[] = []
        if (sessionMatch) {
          const used = parseFloat(sessionMatch[1])
          buckets.push({
            name: "5-Hour Session",
            window: "5h",
            remaining_fraction: Math.max(0, Math.min(1, (100 - used) / 100)),
            reset_time: sessionMatch[2]?.trim(),
          })
        }
        if (weekMatch) {
          const used = parseFloat(weekMatch[1])
          buckets.push({
            name: "Weekly Quota",
            window: "weekly",
            remaining_fraction: Math.max(0, Math.min(1, (100 - used) / 100)),
            reset_time: weekMatch[2]?.trim(),
          })
        }
        if (buckets.length > 0) {
          return [{ name: "Claude", description: "Claude Pro/Max", buckets }]
        }
      }
    }
  } catch {}

  const auth = await readStoredClaudeAuth()
  const token = auth?.access ?? auth?.token

  if (!token) {
    const hint = "Is Claude connected? Run `claude setup-token` or export CLAUDE_CODE_OAUTH_TOKEN."
    throw new Error(`Claude auth is required. ${hint}`)
  }

  let orgId = auth?.orgId

  // Discover organization id if not already known
  if (!orgId) {
    try {
      const orgRes = await fetch(CLAUDE_DEFAULT_ORG_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "opencode",
        },
      })
      if (orgRes.ok) {
        const orgData = (await orgRes.json()) as Array<{ id?: string; uuid?: string }> | { id?: string; uuid?: string }
        if (Array.isArray(orgData) && orgData.length > 0) {
          orgId = orgData[0]?.id ?? orgData[0]?.uuid
        } else if (orgData && typeof orgData === "object") {
          orgId = (orgData as { id?: string; uuid?: string }).id ?? (orgData as { id?: string; uuid?: string }).uuid
        }
      }
    } catch {}
  }

  const usageUrl = orgId
    ? `${CLAUDE_USAGE_BASE_URL}/organizations/${orgId}/usage`
    : `${CLAUDE_USAGE_BASE_URL}/usage`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6_000)

  try {
    const response = await fetch(usageUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "opencode",
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "unknown error")
      throw new Error(`Claude usage error ${response.status}: ${body}`)
    }

    const payload = (await response.json()) as unknown
    return normalizeClaudeUsagePayload(payload)
  } finally {
    clearTimeout(timer)
  }
}

export function normalizeClaudeUsagePayload(payload: unknown): AgyUsageGroup[] {
  if (!payload || typeof payload !== "object") return []
  const data = payload as Record<string, unknown>

  const fiveHour = (data.five_hour ?? data.fiveHour ?? data.primary) as Record<string, unknown> | undefined
  const sevenDay = (data.seven_day ?? data.sevenDay ?? data.weekly ?? data.secondary) as Record<string, unknown> | undefined

  const buckets: AgyUsageBucket[] = []

  const parsePercent = (val: unknown): number | undefined => {
    if (typeof val === "number" && Number.isFinite(val)) return val
    if (typeof val === "string") {
      const n = parseFloat(val)
      return isNaN(n) ? undefined : n
    }
    return undefined
  }

  const toIsoReset = (val: unknown): string | undefined => {
    if (typeof val === "number" && Number.isFinite(val)) {
      return val > 1e11 ? new Date(val).toISOString() : new Date(val * 1000).toISOString()
    }
    if (typeof val === "string" && val.trim()) return val.trim()
    return undefined
  }

  if (fiveHour && typeof fiveHour === "object") {
    const rawVal = parsePercent(fiveHour.utilization) ?? parsePercent(fiveHour.used_percent) ?? parsePercent(fiveHour.usedPercent)
    if (rawVal !== undefined) {
      const usedPercent = rawVal <= 1.0 ? rawVal * 100 : rawVal
      buckets.push({
        name: "5-Hour Session",
        window: "5h",
        remaining_fraction: Math.max(0, Math.min(1, (100 - usedPercent) / 100)),
        reset_time: toIsoReset(fiveHour.resets_at ?? fiveHour.resetsAt) || new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
      })
    }
  }

  if (sevenDay && typeof sevenDay === "object") {
    const rawVal = parsePercent(sevenDay.utilization) ?? parsePercent(sevenDay.used_percent) ?? parsePercent(sevenDay.usedPercent)
    if (rawVal !== undefined) {
      const usedPercent = rawVal <= 1.0 ? rawVal * 100 : rawVal
      buckets.push({
        name: "Weekly Quota",
        window: "weekly",
        remaining_fraction: Math.max(0, Math.min(1, (100 - usedPercent) / 100)),
        reset_time: toIsoReset(sevenDay.resets_at ?? sevenDay.resetsAt) || new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      })
    }
  }

  if (buckets.length === 0) return []

  const planType = stringVal(data.plan_type) ?? stringVal(data.planType)
  const description = planType ? `Claude (${planType.replace(/^claude_/, "").toUpperCase()})` : "Claude Pro/Max"

  return [
    {
      name: "Claude",
      description,
      buckets,
    },
  ]
}

// ============================================================
// LanguageModelV3 implementation driving Claude CLI
// ============================================================

type RecordValue = Record<string, unknown>
type StreamUsage = Extract<LanguageModelV3StreamPart, { type: "finish" }>["usage"]

function record(input: unknown): input is RecordValue {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function extractSystemAndUserPrompt(input: unknown): { systemPrompt: string; promptText: string } {
  let systemPrompt = "You are a helpful AI assistant."
  if (!Array.isArray(input)) return { systemPrompt, promptText: String(input ?? "") }

  const systemParts: string[] = []
  const conversationMessages: any[] = []

  for (const message of input) {
    if (!record(message)) continue
    if (message.role === "system") {
      const parts = Array.isArray(message.content) ? message.content : [message.content]
      for (const p of parts) {
        if (typeof p === "string" && p.trim()) systemParts.push(p.trim())
        else if (record(p) && typeof p.text === "string" && p.text.trim()) systemParts.push(p.text.trim())
      }
    } else {
      conversationMessages.push(message)
    }
  }

  if (systemParts.length > 0) {
    systemPrompt = systemParts.join("\n\n")
  }

  const promptText = formatClaudePrompt(conversationMessages.length > 0 ? conversationMessages : input)
  return { systemPrompt, promptText }
}

function formatClaudePrompt(input: unknown): string {
  if (typeof input === "string") return input
  if (!Array.isArray(input)) return String(input ?? "")
  return input
    .map((message) => {
      if (!record(message)) return String(message)
      const role = typeof message.role === "string" ? message.role : "user"
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
          return ""
        })
        .filter(Boolean)
        .join("\n")
      return `<${role}>\n${body}\n</${role}>`
    })
    .join("\n\n")
}

function claudeUsage(input: unknown): StreamUsage {
  if (!record(input)) {
    return {
      inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
      raw: undefined,
    } as StreamUsage
  }
  const payload = record(input.result) ? input.result : record(input.message) ? input.message : input
  const source = record(payload.usage) ? payload.usage : payload
  const number = (key: string) => (typeof source[key] === "number" ? source[key] : undefined)
  const inputTokens = number("input_tokens") ?? number("inputTokens")
  const outputTokens = number("output_tokens") ?? number("outputTokens")
  const cacheRead = number("cache_read_input_tokens") ?? number("cacheReadInputTokens")
  const cacheWrite = number("cache_creation_input_tokens") ?? number("cacheCreationInputTokens")
  const thinkingDetails = record(source.output_tokens_details) ? source.output_tokens_details : undefined
  const thinking =
    (typeof thinkingDetails?.thinking_tokens === "number" ? thinkingDetails.thinking_tokens : undefined) ??
    number("thinking_tokens")
  return {
    inputTokens: {
      total: inputTokens !== undefined ? inputTokens + (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined,
      noCache: inputTokens,
      cacheRead,
      cacheWrite,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens !== undefined && thinking !== undefined ? Math.max(0, outputTokens - thinking) : outputTokens,
      reasoning: thinking,
    },
    raw: source,
  } as StreamUsage
}

function claudeMetadata(input: unknown): SharedV3ProviderMetadata {
  if (!record(input)) return { claude: {} }
  const payload = record(input.result) ? input.result : record(input.message) ? input.message : input
  const source = record(payload.usage) ? payload.usage : payload
  const cost =
    (typeof payload.total_cost_usd === "number" && Number.isFinite(payload.total_cost_usd) ? payload.total_cost_usd : undefined) ??
    (typeof payload.cost === "number" && Number.isFinite(payload.cost) ? payload.cost : undefined)
  return {
    claude: {
      usage: source,
      ...(cost === undefined ? {} : { cost }),
      ...(typeof payload.session_id === "string" ? { session_id: payload.session_id } : {}),
    },
  } as SharedV3ProviderMetadata
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max"

function effortOf(value: unknown): Effort | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max") {
    return value
  }
  return undefined
}

export function createClaudeLanguageModel(modelID: string, options: Record<string, unknown>): LanguageModelV3 {
  const providerOptions = record(options.providerOptions) ? options.providerOptions : undefined
  const variant = record(providerOptions?.claude) ? providerOptions.claude : undefined
  const effort = effortOf(variant?.effort) ?? effortOf(options.effort)

  const doStream = async (streamOptions: Parameters<LanguageModelV3["doStream"]>[0]) => {
    let cancelled = false
    let child: any

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] })

        let textStarted = false
        const startText = () => {
          if (textStarted) return
          textStarted = true
          emit({ type: "text-start", id: "claude" })
        }

        let thinkingStarted = false
        const startThinking = () => {
          if (thinkingStarted) return
          thinkingStarted = true
          emit({ type: "reasoning-start", id: "claude-thought" })
        }
        const endThinking = () => {
          if (!thinkingStarted) return
          thinkingStarted = false
          emit({ type: "reasoning-end", id: "claude-thought" })
        }

        let sent = ""
        let lastEvent: unknown
        let cliError: string | undefined
        let closed = false

        const emit = (part: LanguageModelV3StreamPart) => {
          try {
            controller.enqueue(part)
          } catch {}
        }

        const closeStream = () => {
          if (closed) return
          closed = true
          try {
            controller.close()
          } catch {}
        }

        const processEvent = (event: unknown) => {
          if (!record(event)) return
          lastEvent = event
          if (event.is_error && typeof event.result === "string") {
            cliError = event.result
          }
          if (record(event.result) && typeof event.result.error === "string") {
            cliError = event.result.error
          }

          // Handle assistant text and reasoning
          if (event.type === "assistant" && record(event.message)) {
            const content = event.message.content
            if (Array.isArray(content)) {
              for (const part of content) {
                if (!record(part)) continue
                if (part.type === "thinking" && typeof part.thinking === "string") {
                  startThinking()
                  emit({ type: "reasoning-delta", id: "claude-thought", delta: part.thinking })
                }
                if (typeof part.text === "string") {
                  endThinking()
                  const text = part.text
                  const delta = text.startsWith(sent) ? text.slice(sent.length) : text
                  if (delta) {
                    startText()
                    sent += delta
                    emit({ type: "text-delta", id: "claude", delta })
                  }
                }
              }
            }
          }

          // Handle live rate limit events
          if (event.type === "rate_limit_event" && record(event.rate_limit_info)) {
            const info = event.rate_limit_info
            if (record(info.unifiedWindows)) {
              const fiveHour = record(info.unifiedWindows.five_hour) ? info.unifiedWindows.five_hour : undefined
              const sevenDay = record(info.unifiedWindows.seven_day) ? info.unifiedWindows.seven_day : undefined
              const buckets: AgyUsageBucket[] = []
              if (fiveHour && typeof fiveHour.utilization === "number") {
                const u = fiveHour.utilization
                const used = u <= 1 ? u * 100 : u
                const resetsAt = typeof fiveHour.resetsAt === "number" ? new Date(fiveHour.resetsAt * 1000).toISOString() : undefined
                buckets.push({
                  name: "5-Hour Session",
                  window: "5h",
                  remaining_fraction: Math.max(0, Math.min(1, (100 - used) / 100)),
                  reset_time: resetsAt,
                })
              }
              if (sevenDay && typeof sevenDay.utilization === "number") {
                const u = sevenDay.utilization
                const used = u <= 1 ? u * 100 : u
                const resetsAt = typeof sevenDay.resetsAt === "number" ? new Date(sevenDay.resetsAt * 1000).toISOString() : undefined
                buckets.push({
                  name: "Weekly Quota",
                  window: "weekly",
                  remaining_fraction: Math.max(0, Math.min(1, (100 - used) / 100)),
                  reset_time: resetsAt,
                })
              }
              if (buckets.length > 0) {
                usageCache = { at: Date.now(), groups: [{ name: "Claude", description: "Claude Pro/Max", buckets }] }
              }
            }
          }

          // Handle result event
          if (event.type === "result" && typeof event.result === "string") {
            endThinking()
            const text = event.result
            const delta = text.startsWith(sent) ? text.slice(sent.length) : text
            if (delta) {
              startText()
              sent += delta
              emit({ type: "text-delta", id: "claude", delta })
            }
          }
        }

        const run = async () => {
          try {
            const cwd = process.cwd()
            const binary = resolveClaudeBinary()
            const { spawn: spawnChild } = await import("node:child_process")
            const { systemPrompt, promptText } = extractSystemAndUserPrompt(streamOptions.prompt)
            child = spawnChild(
              binary,
              [
                "--model",
                modelID,
                "--system-prompt",
                systemPrompt,
                "--setting-sources",
                "",
                "--strict-mcp-config",
                "--tools",
                "",
                "--output-format",
                "stream-json",
                "--verbose",
                ...(effort ? ["--effort", effort] : []),
              ],
              { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
            )

            const abort = () => {
              cancelled = true
              child?.kill()
            }
            streamOptions.abortSignal?.addEventListener("abort", abort, { once: true })

            const safePrompt = promptText.trim() ? promptText : "Hello"
            child.stdin.write(safePrompt + "\n")
            child.stdin.end()

            let processOutput = ""
            let processError = ""
            child.stdout.setEncoding("utf8")
            child.stdout.on("data", (chunk: string) => {
              processOutput += chunk
              const lines = processOutput.split(/\r?\n/)
              processOutput = lines.pop() ?? ""
              for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed || !trimmed.startsWith("{")) continue
                try {
                  processEvent(JSON.parse(trimmed) as unknown)
                } catch {}
              }
            })

            child.stderr.setEncoding("utf8")
            child.stderr.on("data", (chunk: string) => {
              processError += chunk
            })

            const exitCode = await new Promise<number>((resolve, reject) => {
              child.once("error", reject)
              child.once("exit", (code: number | null) => resolve(code ?? 1))
            })

            streamOptions.abortSignal?.removeEventListener("abort", abort)

            if (cancelled) {
              closeStream()
              return
            }

            if (processOutput.trim() && processOutput.trim().startsWith("{")) {
              try {
                processEvent(JSON.parse(processOutput.trim()) as unknown)
              } catch {}
            }

            if (exitCode !== 0 && !sent) {
              throw new Error(cliError || processError.trim() || `claude exited with code ${exitCode}`)
            }

            endThinking()
            if (textStarted) emit({ type: "text-end", id: "claude" })
            controller.enqueue({
              type: "finish",
              usage: claudeUsage(lastEvent),
              finishReason: { unified: "stop", raw: "claude" },
              providerMetadata: claudeMetadata(lastEvent),
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
        try {
          child?.kill()
        } catch {}
      },
    })

    return { stream }
  }

  return {
    specificationVersion: "v3",
    provider: "claude",
    modelId: modelID,
    supportedUrls: {},
    async doGenerate(genOptions: Parameters<LanguageModelV3["doGenerate"]>[0]) {
      const result = await doStream(genOptions)
      const reader = result.stream.getReader()
      let value = ""
      let finalUsage = claudeUsage(undefined)
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
        content: value ? [{ type: "text" as const, text: value }] : [],
        finishReason: { unified: "stop" as const, raw: "claude" },
        usage: finalUsage,
        providerMetadata: finalMetadata,
        warnings: [],
      }
    },
    doStream,
  }
}
