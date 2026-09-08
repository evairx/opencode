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
  effort?: "low" | "medium" | "high"
  variants?: typeof GEMINI_VARIANTS
}

const MODELS: ModelDef[] = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", family: "gemini-flash", effort: "low", variants: GEMINI_VARIANTS },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", family: "gemini-flash", effort: "low", variants: GEMINI_VARIANTS },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", family: "gemini-flash", effort: "low", variants: GEMINI_VARIANTS },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", family: "gemini-pro", effort: "low", variants: GEMINI_PRO_VARIANTS },
  { id: "claude-sonret-4.6", name: "Claude Sonnet 4.6", family: "claude" },
  { id: "claude-opus-4.6", name: "Claude Opus 4.6", family: "claude" },
  { id: "gpt-oss-120b", name: "GPT-OSS 120B", family: "gpt-oss", effort: "medium", variants: GPT_OSS_VARIANTS },
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
          // The CLI reports runtime token usage. $0.75/$3.75 per million
          // tokens is Antigravity's advertised Gemini 3.8 Flash price.
          draft.cost = [{ input: 0.75, output: 3.75, cache: { read: 0, write: 0 } }]
          draft.limit = { context: 1_000_000, input: 1_000_000, output: 65_536 }
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
