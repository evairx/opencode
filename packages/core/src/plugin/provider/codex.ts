import { createServer } from "node:http"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Deferred, Effect } from "effect"
import type { Scope } from "effect"
import {
  CODEX_BASE_URL,
  CODEX_CALLBACK_PORT,
  CODEX_CLIENT_ID,
  CODEX_ISSUER,
  CODEX_MODELS,
  buildCodexAuthorizeUrl,
  exchangeCodexCodeForTokens,
  extractCodexAccountId,
  generateCodexPkce,
} from "../../codex"
import { Credential } from "../../credential"
import { InstallationVersion } from "../../installation/version"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { OauthCallbackPage } from "../../oauth/page"
import { ProviderV2 } from "../../provider"
import type { PluginInternal } from "../internal"

const providerID = ProviderV2.ID.make("codex")
const browserMethodID = Integration.MethodID.make("codex-browser")
const headlessMethodID = Integration.MethodID.make("codex-headless")
const pollingSafetyMargin = 3000

type TokenResponse = {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

function credential(methodID: Integration.MethodID, tokens: TokenResponse) {
  const accountID = extractCodexAccountId(tokens)
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    metadata: accountID ? { accountID } : undefined,
  })
}

const browser = {
  integrationID: Integration.ID.make("codex"),
  method: {
    id: browserMethodID,
    type: "oauth",
    label: "Sign in with ChatGPT",
  },
  authorize: () =>
    Effect.gen(function* () {
      const pkce = yield* Effect.promise(generateCodexPkce)
      const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
      const code = yield* Deferred.make<string, Error>()
      const redirect = `http://localhost:${CODEX_CALLBACK_PORT}/auth/callback`
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", `http://localhost:${CODEX_CALLBACK_PORT}`)
        if (url.pathname !== "/auth/callback") {
          response.writeHead(404).end("Not found")
          return
        }
        const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
        const value = url.searchParams.get("code")
        if (error) {
          Effect.runFork(Deferred.fail(code, new Error(error)))
          response.writeHead(400, { "Content-Type": "text/html" }).end(OauthCallbackPage.error(error, { provider: "Codex" }))
          return
        }
        if (!value || url.searchParams.get("state") !== state) {
          const message = value ? "Invalid OAuth state" : "Missing authorization code"
          Effect.runFork(Deferred.fail(code, new Error(message)))
          response.writeHead(400, { "Content-Type": "text/html" }).end(OauthCallbackPage.error(message, { provider: "Codex" }))
          return
        }
        Effect.runFork(Deferred.succeed(code, value))
        response.writeHead(200, { "Content-Type": "text/html" }).end(OauthCallbackPage.success({ provider: "Codex" }))
      })
      yield* Effect.callback<void, Error>((resume) => {
        server.once("error", (error) => resume(Effect.fail(error)))
        server.listen(CODEX_CALLBACK_PORT, "localhost", () => resume(Effect.void))
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
      return {
        mode: "auto" as const,
        url: buildCodexAuthorizeUrl(redirect, pkce, state),
        instructions: "Complete authorization in your browser. This window will close automatically.",
        callback: Deferred.await(code).pipe(
          Effect.flatMap((value) =>
            Effect.promise(() => exchangeCodexCodeForTokens(value, redirect, pkce)),
          ),
          Effect.map((tokens) => credential(browserMethodID, tokens)),
        ),
      }
    }),
  refresh: (value) => refreshCredential(browserMethodID, value),
} satisfies IntegrationOAuthMethodRegistration

const headless = {
  integrationID: Integration.ID.make("codex"),
  method: {
    id: headlessMethodID,
    type: "oauth",
    label: "Enter a code from ChatGPT",
  },
  authorize: () =>
    Effect.gen(function* () {
      const device = yield* request<{ device_auth_id: string; user_code: string; interval: string }>(
        `${CODEX_ISSUER}/api/accounts/deviceauth/usercode`,
        {
          method: "POST",
          headers: headers("application/json"),
          body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
        },
      )
      const interval = Math.max(Number.parseInt(device.interval) || 5, 1) * 1000
      return {
        mode: "auto" as const,
        url: `${CODEX_ISSUER}/codex/device`,
        instructions: `Enter code: ${device.user_code}`,
        callback: Effect.gen(function* () {
          while (true) {
            const response = yield* Effect.tryPromise({
              try: (signal) =>
                fetch(`${CODEX_ISSUER}/api/accounts/deviceauth/token`, {
                  method: "POST",
                  headers: headers("application/json"),
                  body: JSON.stringify({ device_auth_id: device.device_auth_id, user_code: device.user_code }),
                  signal,
                }),
              catch: (cause) => cause,
            })
            if (response.ok) {
              const data = (yield* Effect.promise(() => response.json())) as {
                authorization_code: string
                code_verifier: string
              }
              const tokens = yield* Effect.promise(() =>
                exchangeCodexCodeForTokens(data.authorization_code, `${CODEX_ISSUER}/deviceauth/callback`, {
                  verifier: data.code_verifier,
                  challenge: "",
                }),
              )
              return credential(headlessMethodID, tokens)
            }
            if (response.status !== 403 && response.status !== 404) {
              return yield* Effect.fail(new Error(`Device authorization failed: ${response.status}`))
            }
            yield* Effect.sleep(interval + pollingSafetyMargin)
          }
        }),
      }
    }),
  refresh: (value) => refreshCredential(headlessMethodID, value),
} satisfies IntegrationOAuthMethodRegistration

export const CodexPlugin = define({
  id: "codex",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.update("codex", (integration) => {
        integration.name = "Codex"
      })
      draft.method.update(browser)
      draft.method.update(headless)
    })
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(providerID, (provider) => {
        provider.name = "Codex"
        provider.integrationID = Integration.ID.make("codex")
        provider.api = { type: "aisdk", package: "@ai-sdk/openai", url: CODEX_BASE_URL }
      })
      for (const def of CODEX_MODELS) {
        const modelID = ModelV2.ID.make(def.id)
        catalog.model.update(providerID, modelID, (model) => {
          model.name = def.name
          model.family = ModelV2.Family.make(def.family ?? "codex")
          model.api = {
            id: def.id,
            type: "aisdk",
            package: "@ai-sdk/openai",
            url: CODEX_BASE_URL,
            settings: {},
          }
          model.capabilities = {
            tools: true,
            input: ["text"],
            output: ["text"],
          }
          model.cost = [{ input: def.price.input, output: def.price.output, cache: { read: 0, write: 0 } }]
          model.limit = { context: def.context, input: def.input ?? def.context, output: def.output ?? 65_536 }
          model.status = "active"
          model.enabled = true
        })
      }
    })
    yield* ctx.aisdk.language(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        evt.language = evt.sdk.responses(evt.model.api.id)
      }),
    )
  }),
} satisfies PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>)

function headers(contentType: string) {
  return { "Content-Type": contentType, "User-Agent": `opencode/${InstallationVersion}` }
}

function request<A>(url: string, init: RequestInit) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { ...init, signal })
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      return response.json() as Promise<A>
    },
    catch: (cause) => cause,
  })
}

function refreshCredential(
  methodID: Integration.MethodID,
  value: Pick<Credential.OAuth, "refresh" | "metadata">,
) {
  return request<TokenResponse>(`${CODEX_ISSUER}/oauth/token`, {
    method: "POST",
    headers: headers("application/x-www-form-urlencoded"),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: value.refresh,
      client_id: CODEX_CLIENT_ID,
    }).toString(),
  }).pipe(
    Effect.map((tokens) => {
      const next = credential(methodID, tokens)
      return Credential.OAuth.make({ ...next, metadata: next.metadata ?? value.metadata })
    }),
  )
}
