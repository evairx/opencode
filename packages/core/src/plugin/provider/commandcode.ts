import { Effect } from "effect"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { COMMANDCODE_BASE_URL, COMMANDCODE_MODELS, COMMANDCODE_VARIANTS } from "../../commandcode"
import { define } from "../internal"

const providerID = ProviderV2.ID.make("commandcode")

export const CommandCodePlugin = define({
  id: "commandcode",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.update("commandcode", (integration) => {
        integration.name = "CommandCode"
      })
      draft.method.update({
        integrationID: "commandcode",
        method: { type: "key", label: "CommandCode API key" },
      })
    })
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(providerID, (provider) => {
        provider.name = "CommandCode"
        provider.integrationID = Integration.ID.make("commandcode")
        provider.api = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: COMMANDCODE_BASE_URL,
        }
      })
      for (const def of COMMANDCODE_MODELS) {
        const modelID = ModelV2.ID.make(def.id)
        catalog.model.update(providerID, modelID, (model) => {
          model.name = def.name
          model.family = ModelV2.Family.make(def.family)
          model.api = {
            id: def.id,
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: COMMANDCODE_BASE_URL,
          }
          model.capabilities = {
            tools: true,
            input: def.image ? ["text", "image"] : ["text"],
            output: ["text"],
          }
          model.cost = [
            {
              input: def.input,
              output: def.output,
              cache: { read: def.cacheRead, write: def.cacheWrite },
            },
          ]
          model.limit = { context: def.context, input: def.context, output: 65_536 }
          model.status = "active"
          model.enabled = true
          model.variants = Object.entries(COMMANDCODE_VARIANTS).map(([id, body]) => ({
            id: ModelV2.VariantID.make(id),
            headers: {},
            // V2 variants are raw request-body fields. The legacy provider
            // path uses the AI SDK's camelCase option name instead.
            body: Object.fromEntries(
              Object.entries(body).map(([key, value]) => [key === "reasoningEffort" ? "reasoning_effort" : key, value]),
            ),
          }))
        })
      }
    })
  }),
})
