import { describe, expect, it } from "bun:test"
import {
  extractCodexAccountId,
  extractCodexResidency,
  normalizeCodexUsagePayload,
  parseCodexJwt,
} from "@opencode-ai/core/codex"

function makeToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none" })}.${encode(claims)}.${encode({})}`
}

describe("codex JWT helpers", () => {
  it("parses claims and extracts the ChatGPT account id", () => {
    const token = makeToken({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_123" } })
    const claims = parseCodexJwt(token)
    expect(claims?.["https://api.openai.com/auth"]?.chatgpt_account_id).toBe("acct_123")
    expect(extractCodexAccountId({ access_token: token, refresh_token: "r" })).toBe("acct_123")
  })

  it("falls back to the top-level organizations claim", () => {
    const token = makeToken({ organizations: [{ id: "org_9" }] })
    expect(extractCodexAccountId({ access_token: token, refresh_token: "r" })).toBe("org_9")
  })

  it("extracts compute residency only when constrained", () => {
    const constrained = makeToken({ "https://api.openai.com/auth": { chatgpt_compute_residency: "eu" } })
    expect(extractCodexResidency(constrained)).toBe("eu")
    const unconstrained = makeToken({ "https://api.openai.com/auth": { chatgpt_compute_residency: "no_constraint" } })
    expect(extractCodexResidency(unconstrained)).toBeUndefined()
  })

  it("returns undefined for malformed tokens", () => {
    expect(parseCodexJwt("not-a-jwt")).toBeUndefined()
    expect(extractCodexAccountId({ access_token: "broken", refresh_token: "r" })).toBeUndefined()
  })
})

describe("normalizeCodexUsagePayload", () => {
  it("maps a WHAM rate_limit into the Antigravity usage group shape", () => {
    const resetsAt = 1_700_000_000
    const groups = normalizeCodexUsagePayload({
      plan_type: "chatgpt_plus",
      rate_limit: {
        primary: { used_percent: 60, window_minutes: 300, resets_at: resetsAt },
        secondary: { used_percent: 25, window_minutes: 60 * 24 * 7, resets_at: resetsAt },
      },
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe("Codex")
    expect(groups[0]!.description).toContain("Plus")

    const windows = groups[0]!.buckets.map((bucket) => bucket.window).sort()
    expect(windows).toEqual(["5h", "weekly"])
    const fiveHour = groups[0]!.buckets.find((bucket) => bucket.window === "5h")!
    expect(fiveHour.remaining_fraction).toBeCloseTo(0.4)
    expect(fiveHour.reset_time).toBe(new Date(resetsAt * 1000).toISOString())
  })

  it("returns an empty array for an empty payload", () => {
    expect(normalizeCodexUsagePayload(null)).toEqual([])
    expect(normalizeCodexUsagePayload({})).toEqual([])
  })
})
