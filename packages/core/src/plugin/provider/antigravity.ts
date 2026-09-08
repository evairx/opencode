import { Effect } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { beginOAuth, createLanguageModel } from "../../antigravity"
import { define } from "../internal"

const providerID = ProviderV2.ID.make("antigravity")
const methodID = Integration.MethodID.make("google-oauth")

// Reasoning effort is switched through model variants, which the adapter
// folds back into the `agy --model <id>-<effort>` spawn. Models without
// variants (Claude) use their ID verbatim.
const GEMINI_VARIANTS: Array<{ id: string; headers: Record<string, string>; body: Record<string, unknown> }> = [
  { id: "low", headers: {}, body: { effort: "low" } },
  { id: "medium", headers: {}, body: { effort: "medium" } },
  { id: "high", headers: {}, body: { effort: "high" } },
]
const GEMINI_PRO_VARIANTS: Array<{ id: string; headers: Record<string, string>; body: Record<string, unknown> }> = [
  { id: "low", headers: {}, body: { effort: "low" } },
  { id: "high", headers: {}, body: { effort: "high" } },
]
const GPT_OSS_VARIANTS: Array<{ id: string; headers: Record<string, string>; body: Record<string, unknown> }> = [
  { id: "medium", headers: {}, body: { effort: "medium" } },
]

interface ModelDef {
  id: string
  name: string
  family: string
  context: number
  effort?: "low" | "medium" | "high"
  variants?: typeof GEMINI_VARIANTS
  cost: {
    input: number
    output: number
    cache: { read: number; write: number }
    over200K?: {
      input: number
      output: number
      cache: { read: number; write: number }
    }
  }
}

const FLASH_COST = { input: 0.75, output: 3.75, cache: { read: 0, write: 0 } }
const GEMINI_CONTEXT = 1_000_000
const CLAUDE_CONTEXT = 250_000
const GPT_OSS_CONTEXT = 131_072
const GEMINI_PRO_COST = {
  input: 2,
  output: 12,
  cache: { read: 0, write: 0 },
  over200K: { input: 4, output: 18, cache: { read: 0, write: 0 } },
}
const CLAUDE_SONNET_COST = { input: 3, output: 15, cache: { read: 0, write: 0 } }
const CLAUDE_OPUS_COST = { input: 5, output: 25, cache: { read: 0, write: 0 } }
const GPT_OSS_COST = { input: 0.15, output: 0.6, cache: { read: 0, write: 0 } }

const MODELS: ModelDef[] = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    family: "gemini-flash",
    context: GEMINI_CONTEXT,
    effort: "low",
    variants: GEMINI_VARIANTS,
    cost: FLASH_COST,
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    family: "gemini-flash",
    context: GEMINI_CONTEXT,
    effort: "low",
    variants: GEMINI_VARIANTS,
    cost: FLASH_COST,
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    family: "gemini-flash",
    context: GEMINI_CONTEXT,
    effort: "low",
    variants: GEMINI_VARIANTS,
    cost: FLASH_COST,
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    family: "gemini-pro",
    context: GEMINI_CONTEXT,
    effort: "low",
    variants: GEMINI_PRO_VARIANTS,
    cost: GEMINI_PRO_COST,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    family: "claude",
    context: CLAUDE_CONTEXT,
    cost: CLAUDE_SONNET_COST,
  },
  {
    id: "claude-opus-4-6-thinking",
    name: "Claude Opus 4.6",
    family: "claude",
    context: CLAUDE_CONTEXT,
    cost: CLAUDE_OPUS_COST,
  },
  {
    id: "gpt-oss-120b-medium",
    name: "GPT-OSS 120B",
    family: "gpt-oss",
    context: GPT_OSS_CONTEXT,
    effort: "medium",
    variants: GPT_OSS_VARIANTS,
    cost: GPT_OSS_COST,
  },
]

const oauth = {
  integrationID: "antigravity",
  method: {
    id: methodID,
    type: "oauth",
    label: "Google OAuth via Antigravity CLI",
  },
  authorize: () =>
    Effect.gen(function* () {
      const session = yield* Effect.promise(beginOAuth)
      yield* Effect.addFinalizer(() => Effect.sync(session.stop))
      return {
        mode: "code" as const,
        url: session.url,
        instructions: "Sign in with Google, then paste the authorization code returned by Antigravity.",
        callback: (code: string) =>
          Effect.promise(async () => {
            await session.complete(code)
            return Credential.OAuth.make({
              type: "oauth",
              methodID,
              access: "agy-cli-session",
              refresh: "agy-cli-session",
              expires: 0,
            })
          }),
      }
    }),
} satisfies IntegrationOAuthMethodRegistration

export const AntigravityPlugin = define({
  id: "antigravity",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.update("antigravity", (integration) => {
        integration.name = "Antigravity"
      })
      draft.method.update(oauth)
    })
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(providerID, (provider) => {
        provider.name = "Antigravity"
        provider.integrationID = Integration.ID.make("antigravity")
        provider.api = { type: "aisdk", package: "opencode-antigravity" }
      })
      for (const def of MODELS) {
        const modelID = ModelV2.ID.make(def.id)
        catalog.model.update(providerID, modelID, (draft) => {
          draft.name = def.name
          draft.family = ModelV2.Family.make(def.family)
          draft.api = {
            id: def.id,
            type: "aisdk",
            package: "opencode-antigravity",
            settings: def.effort ? { effort: def.effort } : {},
          }
          draft.capabilities = {
            tools: false,
            input: ["text"],
            output: ["text"],
          }
          // The CLI reports runtime token usage. Keep the per-model prices in
          // the catalog so OpenCode can calculate the monetary cost from the
          // normalized token usage. Gemini Pro has a separate price tier when
          // the prompt context exceeds 200k tokens.
          draft.cost = [
            { input: def.cost.input, output: def.cost.output, cache: def.cost.cache },
            ...(def.cost.over200K
              ? [
                  {
                    tier: { type: "context" as const, size: 200_000 },
                    input: def.cost.over200K.input,
                    output: def.cost.over200K.output,
                    cache: def.cost.over200K.cache,
                  },
                ]
              : []),
          ]
          draft.limit = { context: def.context, input: def.context, output: 65_536 }
          draft.status = "active"
          draft.enabled = true
          if (def.variants) draft.variants = def.variants
        })
      }
    })
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (event) {
        if (event.package !== "opencode-antigravity") return
        event.sdk = {
          languageModel: (id: string) => createLanguageModel(id, event.options),
        }
      }),
    )
  }),
})
