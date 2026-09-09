import { describe, expect, it } from "bun:test"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"

describe("CodexPlugin", () => {
  it("is registered in ProviderPlugins", () => {
    expect(ProviderPlugins.map((item) => item.id)).toContain(PluginV2.ID.make("codex"))
  })
})
