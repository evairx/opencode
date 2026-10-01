import { describe, expect, it } from "bun:test"
import { createClaudeLanguageModel, normalizeClaudeUsagePayload } from "../src/claude"

describe("normalizeClaudeUsagePayload", () => {
  it("maps five_hour and seven_day quotas into the Antigravity usage group shape", () => {
    const resetsAt5h = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
    const resetsAtWeekly = new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString()

    const groups = normalizeClaudeUsagePayload({
      plan_type: "claude_pro",
      five_hour: { utilization: 45, resets_at: resetsAt5h },
      seven_day: { utilization: 20, resets_at: resetsAtWeekly },
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe("Claude")
    expect(groups[0]!.description).toContain("PRO")

    const windows = groups[0]!.buckets.map((bucket) => bucket.window).sort()
    expect(windows).toEqual(["5h", "weekly"])

    const fiveHour = groups[0]!.buckets.find((bucket) => bucket.window === "5h")!
    expect(fiveHour.remaining_fraction).toBeCloseTo(0.55)
    expect(fiveHour.reset_time).toBe(resetsAt5h)

    const weekly = groups[0]!.buckets.find((bucket) => bucket.window === "weekly")!
    expect(weekly.remaining_fraction).toBeCloseTo(0.8)
    expect(weekly.reset_time).toBe(resetsAtWeekly)
  })

  it("handles fractional ratio utilization (e.g. 0.05 = 5% used -> 95% remaining)", () => {
    const groups = normalizeClaudeUsagePayload({
      five_hour: { utilization: 0.05, resetsAt: 1790829600 },
      seven_day: { utilization: 0.1, resetsAt: 1790910000 },
    })

    expect(groups).toHaveLength(1)
    const fiveHour = groups[0]!.buckets.find((bucket) => bucket.window === "5h")!
    expect(fiveHour.remaining_fraction).toBeCloseTo(0.95)
    expect(fiveHour.reset_time).toBe(new Date(1790829600 * 1000).toISOString())

    const weekly = groups[0]!.buckets.find((bucket) => bucket.window === "weekly")!
    expect(weekly.remaining_fraction).toBeCloseTo(0.9)
    expect(weekly.reset_time).toBe(new Date(1790910000 * 1000).toISOString())
  })

  it("handles string percentage and alternate naming shapes", () => {
    const groups = normalizeClaudeUsagePayload({
      primary: { used_percent: "30", resetsAt: "2026-10-01T00:00:00Z" },
      secondary: { used_percent: "10", resetsAt: "2026-10-07T00:00:00Z" },
    })

    expect(groups).toHaveLength(1)
    const fiveHour = groups[0]!.buckets.find((bucket) => bucket.window === "5h")!
    expect(fiveHour.remaining_fraction).toBeCloseTo(0.7)
  })

  it("returns an empty array for empty payload", () => {
    expect(normalizeClaudeUsagePayload({})).toEqual([])
    expect(normalizeClaudeUsagePayload(null)).toEqual([])
  })
})

describe("createClaudeLanguageModel", () => {
  it("creates a LanguageModelV3 instance", () => {
    const model = createClaudeLanguageModel("claude-opus-5-5", {})
    expect(model.specificationVersion).toBe("v3")
    expect(model.provider).toBe("claude")
    expect(model.modelId).toBe("claude-opus-5-5")
    expect(typeof model.doStream).toBe("function")
    expect(typeof model.doGenerate).toBe("function")
  })
})

describe("Claude pricing parser", () => {
  it("normalizes model names into slugs", () => {
    const { modelNameToId } = require("../src/claude")
    expect(modelNameToId("Claude Opus 5.5")).toBe("claude-opus-5-5")
    expect(modelNameToId("Claude Sonnet 4.6")).toBe("claude-sonnet-4-6")
    expect(modelNameToId("Claude Haiku 3.5")).toBe("claude-haiku-3-5")
  })

  it("parses Claude models and prices from HTML table rows", () => {
    const { parseClaudePricingHtml } = require("../src/claude")
    const sampleHtml = `
      <div data-cds="Prose" class="prose docs-prose">
        <table>
          <thead>
            <tr><th>Name</th><th>Input</th><th>Output</th><th>5m writes</th><th>1h writes</th><th>Hits</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><a href="/docs/en/models/opus-5-5">Claude Opus 5.5</a></td>
              <td>$4 / MTok</td>
              <td>$20 / MTok</td>
              <td>$5 / MTok</td>
              <td>$8 / MTok</td>
              <td>$0.20 / MTok</td>
            </tr>
            <tr>
              <td><a href="/docs/en/models/sonnet-5-5">Claude Sonnet 5.5</a></td>
              <td>$2 / MTok</td>
              <td>$10 / MTok</td>
              <td>$2.50 / MTok</td>
              <td>$4 / MTok</td>
              <td>$0.20 / MTok</td>
            </tr>
          </tbody>
        </table>
      </div>
    `
    const models = parseClaudePricingHtml(sampleHtml)
    expect(models).toHaveLength(2)

    const opus = models.find((m: any) => m.id === "claude-opus-5-5")!
    expect(opus).toBeDefined()
    expect(opus.name).toBe("Claude Opus 5.5")
    expect(opus.price.input).toBe(4)
    expect(opus.price.output).toBe(20)
    expect(opus.price.cache?.write).toBe(5)
    expect(opus.price.cache?.write1h).toBe(8)
    expect(opus.price.cache?.read).toBe(0.2)

    const sonnet = models.find((m: any) => m.id === "claude-sonnet-5-5")!
    expect(sonnet).toBeDefined()
    expect(sonnet.price.input).toBe(2)
    expect(sonnet.price.output).toBe(10)
    expect(sonnet.price.cache?.write).toBe(2.5)
    expect(sonnet.price.cache?.write1h).toBe(4)
    expect(sonnet.price.cache?.read).toBe(0.2)
  })
})
