import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect } from "effect"
import type { Scope } from "effect"
import {
  createClaudeLanguageModel,
  getClaudeModels,
  readStoredClaudeAuth,
  writeStoredClaudeAuth,
} from "../../claude"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import type { PluginInternal } from "../internal"

const providerID = ProviderV2.ID.make("claude")
const methodID = Integration.MethodID.make("claude-code")

const oauth = {
  integrationID: Integration.ID.make("claude"),
  method: {
    id: methodID,
    type: "oauth",
    label: "Claude Code (Subscription Pro/Max)",
  },
  authorize: () =>
    Effect.gen(function* () {
      const stored = yield* Effect.promise(readStoredClaudeAuth)
      if (stored?.access || stored?.token) {
        return {
          mode: "auto" as const,
          url: "https://claude.ai",
          instructions: "Connected using Claude Code subscription.",
          callback: Effect.succeed(
            Credential.OAuth.make({
              type: "oauth",
              methodID,
              access: stored.access ?? stored.token!,
              refresh: stored.access ?? stored.token!,
              expires: stored.expires ?? 0,
            }),
          ),
        }
      }
      return {
        mode: "code" as const,
        url: "https://claude.ai",
        instructions: "Run `claude setup-token` in your terminal and enter the token here.",
        callback: (code: string) =>
          Effect.promise(async () => {
            const token = code.trim()
            await writeStoredClaudeAuth({
              type: token.startsWith("sk-ant-oat") ? "oauth" : "api",
              access: token,
              token,
            })
            return Credential.OAuth.make({
              type: "oauth",
              methodID,
              access: token,
              refresh: token,
              expires: 0,
            })
          }),
      }
    }),
} satisfies IntegrationOAuthMethodRegistration

export const ClaudePlugin = define({
  id: "claude",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.update("claude", (integration) => {
        integration.name = "Claude"
      })
      draft.method.update(oauth)
    })
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(providerID, (provider) => {
        provider.name = "Claude"
        provider.integrationID = Integration.ID.make("claude")
        provider.api = { type: "aisdk", package: "opencode-claude" }
      })
      for (const def of getClaudeModels()) {
        const modelID = ModelV2.ID.make(def.id)
        catalog.model.update(providerID, modelID, (model) => {
          model.name = def.name
          model.family = ModelV2.Family.make(def.family ?? "claude")
          model.api = {
            id: def.id,
            type: "aisdk",
            package: "opencode-claude",
            settings: {},
          }
          model.capabilities = {
            tools: false,
            input: ["text"],
            output: ["text"],
          }
          model.cost = [
            {
              input: def.price.input,
              output: def.price.output,
              cache: { read: def.price.cache?.read ?? 0, write: def.price.cache?.write ?? 0 },
            },
          ]
          model.limit = { context: def.context, input: def.input ?? def.context, output: def.output ?? 64_000 }
          model.status = "active"
          model.enabled = true
          if (def.variants) {
            model.variants = def.variants.map((v) => ({ id: v, headers: {}, body: { effort: v } }))
          }
        })
      }
    })
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (event) {
        if (event.package !== "opencode-claude") return
        event.sdk = {
          languageModel: (id: string) => createClaudeLanguageModel(id, event.options),
        }
      }),
    )
  }),
} satisfies PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>)
