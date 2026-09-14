import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { COMMANDCODE_BASE_URL, COMMANDCODE_MODELS } from "@opencode-ai/core/commandcode"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { CommandCodePlugin } from "@opencode-ai/core/plugin/provider/commandcode"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const providerID = ProviderV2.ID.make("commandcode")

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* CommandCodePlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

describe("CommandCodePlugin", () => {
  it.effect("is registered in ProviderPlugins", () =>
    Effect.sync(() => expect(ProviderPlugins.map((item) => item.id)).toContain(PluginV2.ID.make("commandcode"))),
  )

  it.effect("publishes the catalog with OpenAI-compatible and Anthropic Messages routing", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* addPlugin()

      expect(required(yield* catalog.provider.get(providerID))).toMatchObject({
        name: "CommandCode",
        integrationID: Integration.ID.make("commandcode"),
        api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: COMMANDCODE_BASE_URL },
      })

      const models = (yield* catalog.model.all()).filter((item) => item.providerID === providerID)
      expect(models.map((item) => String(item.id)).sort()).toEqual(COMMANDCODE_MODELS.map((item) => item.id).sort())

      const flash = required(yield* catalog.model.get(providerID, ModelV2.ID.make("deepseek/deepseek-v4.1-flash")))
      expect(flash).toMatchObject({
        name: "DeepSeek V4.1 Flash",
        api: { package: "@ai-sdk/openai-compatible", url: COMMANDCODE_BASE_URL },
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost: [{ input: 0.15, output: 0.6, cache: { read: 0.003, write: 0 } }],
        limit: { context: 1_000_000, input: 1_000_000, output: 65_536 },
      })
      expect(flash.variants.map((variant) => variant.id)).toContain(ModelV2.VariantID.make("high"))
      expect(flash.variants.find((variant) => variant.id === ModelV2.VariantID.make("high"))?.body).toEqual({
        reasoning_effort: "high",
      })

      const opus = required(yield* catalog.model.get(providerID, ModelV2.ID.make("claude-opus-5")))
      expect(opus).toMatchObject({
        api: { package: "@ai-sdk/anthropic", url: COMMANDCODE_BASE_URL },
        capabilities: { input: ["text", "image"] },
        cost: [{ input: 5, output: 25, cache: { read: 0.5, write: 6.25 } }],
      })
      expect(opus.variants).toEqual([])
    }),
  )
})
