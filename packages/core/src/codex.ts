import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { AgyUsageBucket, AgyUsageGroup } from "./antigravity"
import { Global } from "./global"

// ============================================================
// Codex (ChatGPT) provider — transport ported from OpenClaude
//
// The official Codex CLI and OpenClaude both authenticate against the
// ChatGPT backend through OpenAI's *Codex CLI OAuth client*. This module
// mirrors that identity (same client id, scopes, originator and callback
// port) so the consent screen and the wire traffic look exactly like the
// official client, while requests stay plain HTTPS to
// `chatgpt.com/backend-api/codex/responses`.
// ============================================================

export const CODEX_ISSUER = "https://auth.openai.com"
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
export const CODEX_CALLBACK_PORT = 1455
export const CODEX_OAUTH_SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke"
export const CODEX_OAUTH_ORIGINATOR = "codex_cli_rs"
export const CODEX_SIMPLIFIED_FLOW = "true"
export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
export const CODEX_API_ENDPOINT = `${CODEX_BASE_URL}/responses`
export const CODEX_WHAM_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
export const CODEX_TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange"
export const CODEX_API_KEY_TOKEN_NAME = "openai-api-key"

export interface CodexTokenResponse {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

export interface CodexPkce {
  verifier: string
  challenge: string
}

export interface CodexIdTokenClaims {
  chatgpt_account_id?: string
  chatgpt_compute_residency?: string
  organizations?: Array<{ id: string }>
  email?: string
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string
    chatgpt_compute_residency?: string
  }
}

// ============================================================
// JWT helpers
// ============================================================

export function parseCodexJwt(token: string): CodexIdTokenClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as CodexIdTokenClaims
  } catch {
    return undefined
  }
}

export function extractCodexAccountIdFromClaims(
  claims: CodexIdTokenClaims | undefined,
): string | undefined {
  if (!claims) return undefined
  return (
    claims.chatgpt_account_id ??
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims.organizations?.[0]?.id
  )
}

export function extractCodexAccountId(tokens: CodexTokenResponse): string | undefined {
  if (tokens.id_token) {
    const accountId = extractCodexAccountIdFromClaims(parseCodexJwt(tokens.id_token))
    if (accountId) return accountId
  }
  return extractCodexAccountIdFromClaims(parseCodexJwt(tokens.access_token))
}

export function extractCodexResidency(token: string): string | undefined {
  const claims = parseCodexJwt(token)
  const residency =
    claims?.["https://api.openai.com/auth"]?.chatgpt_compute_residency ?? claims?.chatgpt_compute_residency
  if (!residency || residency === "no_constraint") return undefined
  return residency
}

// ============================================================
// PKCE + OAuth
// ============================================================

export function base64UrlEncode(input: string | ArrayBuffer): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export async function generateCodexPkce(): Promise<CodexPkce> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(43)))
    .map((byte) => chars[byte % chars.length]!)
    .join("")
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

export function buildCodexAuthorizeUrl(
  redirectUri: string,
  pkce: CodexPkce,
  state: string,
  originator = CODEX_OAUTH_ORIGINATOR,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CODEX_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: CODEX_OAUTH_SCOPE,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: CODEX_SIMPLIFIED_FLOW,
    state,
    originator,
  })
  return `${CODEX_ISSUER}/oauth/authorize?${params.toString()}`
}

export async function exchangeCodexCodeForTokens(
  code: string,
  redirectUri: string,
  pkce: CodexPkce,
  clientId = CODEX_CLIENT_ID,
): Promise<CodexTokenResponse> {
  const response = await fetch(`${CODEX_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) throw new Error(`Codex token exchange failed: ${response.status}`)
  return response.json() as Promise<CodexTokenResponse>
}

/**
 * OpenClaude trick: exchange the OAuth `id_token` for the same `openai-api-key`
 * the official Codex CLI stores in `~/.codex/auth.json`.
 */
export async function exchangeCodexIdTokenForApiKey(
  idToken: string,
  clientId = CODEX_CLIENT_ID,
): Promise<string> {
  const response = await fetch(`${CODEX_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: CODEX_TOKEN_EXCHANGE_GRANT,
      requested_token: CODEX_API_KEY_TOKEN_NAME,
      subject_token: idToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      client_id: clientId,
    }).toString(),
  })
  if (!response.ok) throw new Error(`Codex id_token exchange failed: ${response.status}`)
  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) throw new Error("Codex id_token exchange returned no access token")
  return data.access_token
}

export async function refreshCodexTokens(
  refreshToken: string,
  clientId = CODEX_CLIENT_ID,
): Promise<CodexTokenResponse> {
  const response = await fetch(`${CODEX_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  })
  if (!response.ok) throw new Error(`Codex token refresh failed: ${response.status}`)
  return response.json() as Promise<CodexTokenResponse>
}

// ============================================================
// Stored credential interop
// ============================================================

export interface CodexStoredAuth {
  type?: string
  access?: string
  refresh?: string
  expires?: number
  accountId?: string
}

const authFilePath = () => path.join(Global.Path.data, "auth.json")

export async function readStoredCodexAuth(): Promise<CodexStoredAuth | undefined> {
  if (process.env.OPENCODE_AUTH_CONTENT) {
    try {
      const data = JSON.parse(process.env.OPENCODE_AUTH_CONTENT) as Record<string, unknown>
      const entry = data["codex"]
      if (entry && typeof entry === "object") return entry as CodexStoredAuth
    } catch {}
  }
  try {
    const data = JSON.parse(await readFile(authFilePath(), "utf8")) as Record<string, unknown>
    const entry = data["codex"]
    if (entry && typeof entry === "object") return entry as CodexStoredAuth
  } catch {}
  return undefined
}

async function writeStoredCodexAuth(update: CodexStoredAuth): Promise<void> {
  try {
    const existing = await readStoredCodexAuth()
    const merged = { ...(existing ?? {}), ...update }
    const data = JSON.parse(await readFile(authFilePath(), "utf8")) as Record<string, unknown>
    data["codex"] = merged
    await writeFile(authFilePath(), JSON.stringify(data, null, 2), { mode: 0o600 })
  } catch {}
}

/**
 * Reuse the session created by the official `codex login` CLI. The CLI stores
 * the API key granted by the OAuth token exchange in `~/.codex/auth.json`.
 */
export const codexAuthJsonPath = () =>
  process.env.CODEX_AUTH_JSON_PATH ??
  (process.env.CODEX_HOME
    ? path.join(process.env.CODEX_HOME, "auth.json")
    : path.join(homedir(), ".codex", "auth.json"))

export async function readCodexAuthJson(): Promise<{ apiKey?: string; accountId?: string } | undefined> {
  try {
    const raw = await readFile(codexAuthJsonPath(), "utf8")
    const data = JSON.parse(raw) as Record<string, unknown>
    const tokens = (data.tokens ?? {}) as Record<string, unknown>
    const apiKey = string(data.openai_api_key) ?? string(data.openaiApiKey) ?? string(tokens.access_token)
    const claims = apiKey ? parseCodexJwt(apiKey) : undefined
    const accountId =
      string(data.account_id) ??
      string(data.chatgpt_account_id) ??
      (claims ? extractCodexAccountIdFromClaims(claims) : undefined)
    if (!apiKey) return undefined
    return { apiKey, accountId }
  } catch {
    return undefined
  }
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

// ============================================================
// Models
// ============================================================

export interface CodexModel {
  id: string
  name: string
  family?: string
  context: number
  input?: number
  output?: number
  /** USD per 1M tokens, used by OpenCode to estimate cost. */
  price: { input: number; output: number; cache?: { read: number; write: number } }
  shortContext?: { input: number; cachedInput: number; cacheWrites: number; output: number }
  longContext?: { input: number; cachedInput: number; cacheWrites: number; output: number }
  variants?: readonly string[]
}

// Model identifiers are the backend names the Codex CLI sends verbatim to
// `chatgpt.com/backend-api/codex/responses` (mirrors OpenClaude's alias table).
// Default prices are extracted from https://developers.openai.com/api/docs/pricing
export const CODEX_MODELS: CodexModel[] = [
  {
    id: "gpt-6-astra",
    name: "GPT 6 Astra",
    family: "codex",
    context: 400_000,
    input: 272_000,
    output: 128_000,
    price: { input: 10, output: 50, cache: { read: 1, write: 12.5 } },
    shortContext: { input: 10, cachedInput: 1, cacheWrites: 12.5, output: 50 },
    longContext: { input: 20, cachedInput: 2, cacheWrites: 25, output: 75 },
    variants: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "gpt-6.1-sol",
    name: "GPT 6.1 Sol",
    family: "codex",
    context: 400_000,
    input: 272_000,
    output: 128_000,
    price: { input: 2, output: 10, cache: { read: 0.1, write: 2.5 } },
    shortContext: { input: 2, cachedInput: 0.1, cacheWrites: 2.5, output: 10 },
    longContext: { input: 4, cachedInput: 0.2, cacheWrites: 5, output: 15 },
    variants: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "gpt-6-luna",
    name: "GPT 6 Luna",
    family: "codex",
    context: 400_000,
    input: 272_000,
    output: 128_000,
    price: { input: 0.1, output: 0.5, cache: { read: 0.01, write: 0.125 } },
    shortContext: { input: 0.1, cachedInput: 0.01, cacheWrites: 0.125, output: 0.5 },
    longContext: { input: 0.2, cachedInput: 0.02, cacheWrites: 0.25, output: 0.75 },
    variants: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "gpt-6-sol",
    name: "GPT 6 Sol",
    family: "codex",
    context: 400_000,
    input: 272_000,
    output: 128_000,
    price: { input: 2, output: 10, cache: { read: 0.2, write: 2.5 } },
    shortContext: { input: 2, cachedInput: 0.2, cacheWrites: 2.5, output: 10 },
    longContext: { input: 4, cachedInput: 0.4, cacheWrites: 5, output: 15 },
    variants: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT 5.6 Sol",
    family: "codex",
    context: 400_000,
    input: 272_000,
    output: 128_000,
    price: { input: 4, output: 20, cache: { read: 0.4, write: 5 } },
    shortContext: { input: 4, cachedInput: 0.4, cacheWrites: 5, output: 20 },
    longContext: { input: 8, cachedInput: 0.8, cacheWrites: 10, output: 30 },
    variants: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT 5.6 Terra",
    family: "codex",
    context: 400_000,
    input: 272_000,
    output: 128_000,
    price: { input: 2, output: 12, cache: { read: 0.2, write: 2.5 } },
    shortContext: { input: 2, cachedInput: 0.2, cacheWrites: 2.5, output: 12 },
    longContext: { input: 4, cachedInput: 0.4, cacheWrites: 5, output: 18 },
    variants: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT 5.6 Luna",
    family: "codex",
    context: 400_000,
    input: 272_000,
    output: 128_000,
    price: { input: 0.2, output: 1.2, cache: { read: 0.02, write: 0.25 } },
    shortContext: { input: 0.2, cachedInput: 0.02, cacheWrites: 0.25, output: 1.2 },
    longContext: { input: 0.4, cachedInput: 0.04, cacheWrites: 0.5, output: 1.8 },
    variants: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "gpt-5.5",
    name: "GPT 5.5",
    family: "codex",
    context: 400_000,
    input: 272_000,
    output: 128_000,
    price: { input: 5, output: 30, cache: { read: 0.5, write: 0 } },
    shortContext: { input: 5, cachedInput: 0.5, cacheWrites: 0, output: 30 },
    longContext: { input: 10, cachedInput: 1, cacheWrites: 0, output: 45 },
    variants: ["low", "medium", "high", "xhigh"],
  },
]

// ============================================================
// Scraper & Dynamic Model Catalog
// ============================================================

const CODEX_PRICING_URL = "https://developers.openai.com/api/docs/pricing"

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
}

async function fetchPage(url: string, timeoutMs = 12_000): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function formatModelName(id: string): string {
  return id
    .split("-")
    .map((part) => (part === "gpt" ? "GPT" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ")
}

export async function scrapeCodexModels(timeoutMs = 12_000): Promise<CodexModel[]> {
  const html = await fetchPage(CODEX_PRICING_URL, timeoutMs)

  // 1. Extract rows from Astro Island "TextTokenPricingTables"
  const islands = [...html.matchAll(/<astro-island\b([^>]*)>/g)]
  let standardRows: any[] = []

  for (const tag of islands) {
    const attrs = tag[1]
    if (attrs.includes("TextTokenPricingTables")) {
      const propsMatch = attrs.match(/props="([^"]+)"/)
      if (propsMatch) {
        const decoded = decodeHtmlEntities(propsMatch[1])
        try {
          const parsed = JSON.parse(decoded)
          if (parsed.tier && parsed.tier[1] === "standard" && Array.isArray(parsed.rows?.[1])) {
            standardRows = parsed.rows[1]
            break
          }
        } catch {}
      }
    }
  }

  // 2. Extract Long Context table from companion JS bundle
  let longContextMap: Record<string, Record<string, unknown>> = {}
  const jsMatch = html.match(/component-url="(\/_astro\/pricing\.[^"]+\.js[^"]*)"/)
  if (jsMatch) {
    try {
      const jsUrl = new URL(jsMatch[1], CODEX_PRICING_URL).toString()
      const jsText = await fetchPage(jsUrl, 8000)
      const lMatch = jsText.match(/standard:(\{[\s\S]*?\}),fast:/)
      if (lMatch) {
        longContextMap = new Function(`return (${lMatch[1]})`)()
      }
    } catch {}
  }

  const parseNumber = (val: unknown): number => {
    if (typeof val === "number") return val
    if (!val || val === "-" || val === "—") return 0
    const num = parseFloat(String(val).replace(/[^0-9.]/g, ""))
    return isNaN(num) ? 0 : num
  }

  const models: CodexModel[] = []

  for (const item of standardRows) {
    const row = item[1]
    if (!row || !row[0]) continue

    const rawName = String(row[0][1] || "")
    const cleanId = rawName.replace(/ \(.+$/, "").trim()

    // Stop and exclude gpt-5.5-pro and below
    if (cleanId === "gpt-5.5-pro") {
      break
    }

    const isTargetRange =
      cleanId.startsWith("gpt-6") ||
      cleanId.startsWith("gpt-5.6") ||
      cleanId === "gpt-5.5"

    if (!isTargetRange) continue

    const shortInput = parseNumber(row[1]?.[1])
    const shortCached = parseNumber(row[2]?.[1])
    const shortWrite = parseNumber(row[3]?.[1])
    const shortOutput = parseNumber(row[4]?.[1])

    const long = longContextMap[cleanId] || {}
    const longInput = parseNumber(long.input)
    const longCached = parseNumber(long.cachedInput)
    const longWrite = parseNumber(long.cacheWrite)
    const longOutput = parseNumber(long.output)

    models.push({
      id: cleanId,
      name: formatModelName(cleanId),
      family: "codex",
      context: 400_000,
      input: 272_000,
      output: 128_000,
      shortContext: {
        input: shortInput,
        cachedInput: shortCached,
        cacheWrites: shortWrite,
        output: shortOutput,
      },
      longContext: {
        input: longInput,
        cachedInput: longCached,
        cacheWrites: longWrite,
        output: longOutput,
      },
      price: {
        input: shortInput,
        output: shortOutput,
        cache: {
          read: shortCached,
          write: shortWrite,
        },
      },
      variants: ["low", "medium", "high", "xhigh"],
    })
  }

  return models
}

let memoryCache: CodexModel[] | undefined

export function loadCachedCodexModels(): { models: CodexModel[]; isFresh: boolean } | undefined {
  if (memoryCache && memoryCache.length > 0) {
    return { models: memoryCache, isFresh: true }
  }
  try {
    const file = path.join(Global.Path.cache, "codex-models.json")
    if (!existsSync(file)) return undefined
    const content = readFileSync(file, "utf8")
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed) && parsed.length > 0) {
      memoryCache = parsed
      return { models: parsed, isFresh: false }
    }
    if (parsed && Array.isArray(parsed.models) && parsed.models.length > 0) {
      memoryCache = parsed.models
      const isFresh = Date.now() - (parsed.updatedAt || 0) < 1000 * 60 * 60 * 2 // 2 hours
      return { models: parsed.models, isFresh }
    }
  } catch {}
  return undefined
}

export function saveCachedCodexModels(models: CodexModel[]): void {
  try {
    memoryCache = models
    const file = path.join(Global.Path.cache, "codex-models.json")
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ updatedAt: Date.now(), models }, null, 2), "utf8")
  } catch {}
}

export function getCodexModels(): CodexModel[] {
  const cached = loadCachedCodexModels()
  if (cached?.models && cached.models.length > 0) return cached.models
  return CODEX_MODELS
}

export async function refreshCodexModels(force = false): Promise<CodexModel[]> {
  const cached = loadCachedCodexModels()
  if (!force && cached?.isFresh) {
    return cached.models
  }

  const scraped = await scrapeCodexModels().catch(() => [])
  if (scraped.length > 0) {
    saveCachedCodexModels(scraped)
    return scraped
  }

  return cached?.models ?? CODEX_MODELS
}

// ============================================================
// WHAM usage (rendered by the same dialog Antigravity uses)
// ============================================================

// Quota refreshes slowly and WHAM is a network round trip, so cache the result
// briefly and coalesce concurrent callers (same pattern as getAgyUsage).
let usageCache: { at: number; groups: AgyUsageGroup[] } | undefined
let usageInFlight: Promise<AgyUsageGroup[]> | undefined

export async function getCodexUsage(force = false): Promise<AgyUsageGroup[]> {
  if (!force && usageCache && Date.now() - usageCache.at < 60_000) return usageCache.groups
  if (!usageInFlight) {
    usageInFlight = fetchCodexUsage()
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

async function fetchCodexUsage(): Promise<AgyUsageGroup[]> {
  let auth = await readStoredCodexAuth()
  if (auth?.type !== "oauth" || !auth.access || !auth.refresh) {
    const hint = "Is Codex connected? Run /connect and pick Codex OAuth, or `codex login` and re-open."
    throw new Error(`Codex auth is required. ${hint}`)
  }
  if (auth.expires && auth.expires < Date.now()) {
    const refreshed = await refreshStoredAuth(auth)
    if (refreshed) auth = refreshed
  }
  if (!auth.access || !auth.accountId) {
    throw new Error("Codex auth is missing the ChatGPT account id. Re-login with Codex OAuth.")
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetch(CODEX_WHAM_USAGE_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${auth.access}`,
        "chatgpt-account-id": auth.accountId,
        originator: CODEX_OAUTH_ORIGINATOR,
        "User-Agent": "opencode",
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "unknown error")
      throw new Error(`Codex usage error ${response.status}: ${body}`)
    }
    const payload = (await response.json()) as unknown
    return normalizeCodexUsagePayload(payload)
  } finally {
    clearTimeout(timer)
  }
}

async function refreshStoredAuth(auth: CodexStoredAuth): Promise<CodexStoredAuth | undefined> {
  if (!auth.refresh) return undefined
  try {
    const tokens = await refreshCodexTokens(auth.refresh)
    const accountId = extractCodexAccountId(tokens) ?? auth.accountId
    const next: CodexStoredAuth = {
      ...auth,
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      accountId,
    }
    await writeStoredCodexAuth(next)
    return next
  } catch {
    return undefined
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

interface WhamWindow {
  usedPercent: number
  windowMinutes?: number
  resetsAt?: string
}

interface WhamCredits {
  hasCredits: boolean
  unlimited: boolean
  balance?: string
}

interface WhamSnapshot {
  limitName: string
  primary?: WhamWindow
  secondary?: WhamWindow
  credits?: WhamCredits
}

function normalizeWhamWindow(value: unknown): WhamWindow | undefined {
  if (!record(value)) return undefined
  const usedPercent = asNumber(value.used_percent) ?? asNumber(value.usedPercent)
  if (usedPercent === undefined) return undefined
  const windowMinutes =
    asNumber(value.window_minutes) ??
    asNumber(value.windowDurationMins) ??
    (() => {
      const seconds = asNumber(value.limit_window_seconds)
      return seconds === undefined ? undefined : Math.round(seconds / 60)
    })()
  const resetsAt = isoFromUnixSeconds(value.resets_at) ?? isoFromUnixSeconds(value.resetsAt) ?? isoFromUnixSeconds(value.reset_at)
  return { usedPercent, windowMinutes, resetsAt }
}

function normalizeWhamCredits(value: unknown): WhamCredits | undefined {
  if (!record(value)) return undefined
  const hasCredits = value.has_credits === true || value.hasCredits === true
  const unlimited = value.unlimited === true
  const balance = asString(value.balance)
  if (!hasCredits && !unlimited && !balance) return undefined
  return { hasCredits, unlimited, balance }
}

function normalizeWhamSnapshot(value: unknown, fallback: string): WhamSnapshot | undefined {
  if (!record(value)) return undefined
  const limitName =
    asString(value.limit_name) ?? asString(value.limitName) ?? asString(value.limit_id) ?? asString(value.limitId) ?? fallback
  const primary = normalizeWhamWindow(value.primary) ?? normalizeWhamWindow(value.primary_window)
  const secondary = normalizeWhamWindow(value.secondary) ?? normalizeWhamWindow(value.secondary_window)
  const credits = normalizeWhamCredits(value.credits)
  if (!primary && !secondary && !credits) return undefined
  return { limitName, primary, secondary, credits }
}

function normalizeSnapshots(value: unknown, defaultName = "codex"): WhamSnapshot[] {
  if (Array.isArray(value)) {
    return value
      .map((item, index) => normalizeWhamSnapshot(item, index === 0 ? defaultName : `${defaultName}-${index + 1}`))
      .filter((item): item is WhamSnapshot => item !== undefined)
  }
  if (!record(value)) return []
  return Object.entries(value)
    .map(([key, entry]) => normalizeWhamSnapshot(entry, key))
    .filter((item): item is WhamSnapshot => item !== undefined)
}

export function normalizeCodexUsagePayload(payload: unknown): AgyUsageGroup[] {
  let snapshots: WhamSnapshot[] = []
  let planType: string | undefined
  if (Array.isArray(payload)) {
    snapshots = normalizeSnapshots(payload)
  } else if (record(payload)) {
    planType = asString(payload.plan_type) ?? asString(payload.planType)
    if ("rate_limit" in payload || "rate_limits" in payload || "rateLimits" in payload || "credits" in payload) {
      const credits = normalizeWhamCredits(payload.credits)
      const single = normalizeWhamSnapshot(payload.rate_limit, "codex")
      if (single) snapshots.push(single)
      else if (credits) snapshots.push({ limitName: "codex", credits })
      const collection = record(payload.rate_limits) ? payload.rate_limits : payload.rateLimits
      if (collection !== undefined) snapshots.push(...normalizeSnapshots(collection))
    } else {
      snapshots = normalizeSnapshots(payload)
      if (snapshots.length === 0) {
        const snapshot = normalizeWhamSnapshot(payload, "codex")
        if (snapshot) snapshots = [snapshot]
      }
    }
  }
  if (snapshots.length === 0) return []

  const buckets: AgyUsageBucket[] = []
  for (const snapshot of snapshots) {
    const limitName = snapshot.limitName.trim() || "codex"
    const appendWindow = (window: WhamWindow | undefined, windowTag: string) => {
      if (!window) return
      const windowName = windowLabel(window.windowMinutes)
      const name =
        limitName.toLowerCase() === "codex"
          ? windowName
          : `${capitalize(limitName)} ${windowName}`
      buckets.push({
        name,
        window: windowName,
        remaining_fraction: clamp((100 - window.usedPercent) / 100),
        reset_time: window.resetsAt,
      })
    }
    appendWindow(snapshot.primary, "primary")
    appendWindow(snapshot.secondary, "secondary")
    if (snapshot.credits?.unlimited) {
      buckets.push({ name: "Credits Unlimited", window: "", remaining_fraction: 1 })
    } else if (snapshot.credits?.hasCredits && snapshot.credits.balance) {
      buckets.push({ name: `Credits ${snapshot.credits.balance}`, window: "", remaining_fraction: 1 })
    }
  }

  return [
    {
      name: "Codex",
      description: planType ? `ChatGPT ${formatPlanType(planType)} plan` : "ChatGPT Codex plan usage",
      buckets,
    },
  ]
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function capitalize(value: string): string {
  if (!value) return value
  return value[0]!.toUpperCase() + value.slice(1)
}

function formatPlanType(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => capitalize(part.toLowerCase()))
    .join(" ")
}

function windowLabel(windowMinutes: number | undefined): string {
  if (windowMinutes === undefined || windowMinutes <= 0) return "5h"
  if (windowMinutes === 60 * 24 * 30 || windowMinutes === 60 * 24 * 28) return "30d"
  if (windowMinutes === 60 * 24 * 7) return "weekly"
  if (windowMinutes % (60 * 24) === 0) return `${windowMinutes / (60 * 24)}d`
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`
  return `${windowMinutes}m`
}

function isoFromUnixSeconds(value: unknown): string | undefined {
  const seconds = asNumber(value)
  if (seconds === undefined) return undefined
  return new Date(seconds * 1000).toISOString()
}

export * as Codex from "./codex"
