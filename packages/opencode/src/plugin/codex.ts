import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { OauthCallbackPage } from "@opencode-ai/core/oauth/page"
import { createServer } from "http"
import type { Server } from "http"
import os from "os"
import { setTimeout as sleep } from "node:timers/promises"
import { OAUTH_DUMMY_KEY } from "../auth"
import {
  CODEX_API_ENDPOINT,
  CODEX_CALLBACK_PORT,
  CODEX_CLIENT_ID,
  CODEX_ISSUER,
  buildCodexAuthorizeUrl,
  exchangeCodexCodeForTokens,
  extractCodexAccountId,
  extractCodexResidency,
  generateCodexPkce,
  readCodexAuthJson,
  refreshCodexTokens,
} from "@opencode-ai/core/codex"

const OAUTH_PORT = CODEX_CALLBACK_PORT
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000
const CODEX_AUTH_STORAGE_KEY = "codex"

function serverPort(server: Server): number {
  const address = server.address()
  if (address && typeof address === "object") return address.port
  return OAUTH_PORT
}

interface PkceCodes {
  verifier: string
  challenge: string
}

interface TokenResponse {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

interface PendingOAuth {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

export async function CodexProviderAuthPlugin(_input: PluginInput): Promise<Hooks> {
  let pendingOAuth: PendingOAuth | undefined
  let oauthServer: Server | undefined

  async function startOAuthServer(): Promise<{ redirectUri: string }> {
    if (oauthServer) {
      return { redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
    }

    const server = createServer((req, res) => {
      const port = serverPort(server)
      const url = new URL(req.url || "/", `http://localhost:${port}`)

      if (url.pathname === "/auth/callback") {
        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")
        const error = url.searchParams.get("error")
        const errorDescription = url.searchParams.get("error_description")

        if (error) {
          const errorMsg = errorDescription || error
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          res.end(OauthCallbackPage.error(errorMsg, { provider: "Codex" }))
          return
        }

        if (!code) {
          const errorMsg = "Missing authorization code"
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          res.end(OauthCallbackPage.error(errorMsg, { provider: "Codex" }))
          return
        }

        if (!pendingOAuth || state !== pendingOAuth.state) {
          const errorMsg = "Invalid state - potential CSRF attack"
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          res.end(OauthCallbackPage.error(errorMsg, { provider: "Codex" }))
          return
        }

        const current = pendingOAuth
        pendingOAuth = undefined

        exchangeCodexCodeForTokens(code, `http://localhost:${port}/auth/callback`, current.pkce)
          .then((tokens) => current.resolve(tokens))
          .catch((err) => current.reject(err))

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        res.end(OauthCallbackPage.success({ provider: "Codex" }))
        return
      }

      res.writeHead(404)
      res.end("Not found")
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        // The OpenAI Codex auth plugin may already own the well-known port.
        // Fall back to an OS-assigned loopback port (RFC 8252 loopback OAuth).
        if (oauthServer) return
        server.removeListener("listening", onListening)
        server.listen(0, "localhost", onListening)
        server.once("error", reject)
        void error
      }
      const onListening = () => resolve()
      server.once("error", onError)
      server.once("listening", onListening)
      server.listen(OAUTH_PORT, "localhost")
    })

    oauthServer = server
    return { redirectUri: `http://localhost:${serverPort(server)}/auth/callback` }
  }

  function stopOAuthServer() {
    if (oauthServer) {
      oauthServer.close(() => {})
      oauthServer = undefined
    }
  }

  function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (pendingOAuth) {
          pendingOAuth = undefined
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      }, 5 * 60 * 1000)

      pendingOAuth = {
        pkce,
        state,
        resolve: (tokens) => {
          clearTimeout(timeout)
          resolve(tokens)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
      }
    })
  }

  return {
    auth: {
      provider: "codex",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "oauth") {
          const imported = await readCodexAuthJson()
          if (auth.type === "api") return { apiKey: auth.key }
          return imported?.apiKey ? { apiKey: imported.apiKey } : {}
        }

        let refreshPromise:
          | Promise<{
              access: string
              accountId: string | undefined
            }>
          | undefined

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.delete("authorization")
                init.headers.delete("Authorization")
              } else if (Array.isArray(init.headers)) {
                init.headers = init.headers.filter(([key]) => key.toLowerCase() !== "authorization")
              } else {
                delete init.headers["authorization"]
                delete init.headers["Authorization"]
              }
            }

            const currentAuth = await getAuth()
            if (currentAuth.type !== "oauth") return fetch(requestInput, init)

            const authWithAccount = currentAuth as typeof currentAuth & { accountId?: string }

            if (!currentAuth.access || currentAuth.expires < Date.now()) {
              if (!refreshPromise) {
                refreshPromise = refreshCodexTokens(currentAuth.refresh)
                  .then(async (tokens) => {
                    const accountId = extractCodexAccountId(tokens) || authWithAccount.accountId
                    await _input.client.auth.set({
                      path: { id: CODEX_AUTH_STORAGE_KEY },
                      body: {
                        type: "oauth",
                        refresh: tokens.refresh_token,
                        access: tokens.access_token,
                        expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                        ...(accountId && { accountId }),
                      },
                    })
                    return {
                      access: tokens.access_token,
                      accountId,
                    }
                  })
                  .finally(() => {
                    refreshPromise = undefined
                  })
              }

              const refreshed = await refreshPromise
              currentAuth.access = refreshed.access
              authWithAccount.accountId = refreshed.accountId
            }

            const headers = new Headers()
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.forEach((value, key) => headers.set(key, value))
              } else if (Array.isArray(init.headers)) {
                for (const [key, value] of init.headers) {
                  if (value !== undefined) headers.set(key, String(value))
                }
              } else {
                for (const [key, value] of Object.entries(init.headers)) {
                  if (value !== undefined) headers.set(key, String(value))
                }
              }
            }
            headers.set("authorization", `Bearer ${currentAuth.access}`)
            if (authWithAccount.accountId) {
              headers.set("ChatGPT-Account-Id", authWithAccount.accountId)
            }
            headers.set("originator", "opencode")
            headers.set("User-Agent", `opencode/${InstallationVersion} (${os.platform()} ${os.release()}; ${os.arch()})`)

            const parsed =
              requestInput instanceof URL
                ? requestInput
                : new URL(typeof requestInput === "string" ? requestInput : requestInput.url)
            const rewrite =
              parsed.pathname.includes("/v1/responses") ||
              parsed.pathname.includes("/responses") ||
              parsed.pathname.includes("/chat/completions")
            const url = rewrite ? new URL(CODEX_API_ENDPOINT) : parsed
            if (rewrite) {
              const residency = extractCodexResidency(currentAuth.access)
              if (residency) headers.set("x-openai-internal-codex-residency", residency)
            }

            return fetch(url, { ...init, headers })
          },
        }
      },
      methods: [
        {
          label: "Sign in with ChatGPT",
          type: "oauth",
          authorize: async () => {
            const { redirectUri } = await startOAuthServer()
            const pkce = await generateCodexPkce()
            const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
            const authUrl = buildCodexAuthorizeUrl(redirectUri, pkce, state)

            const callbackPromise = waitForOAuthCallback(pkce, state)

            return {
              url: authUrl,
              instructions: "Complete authorization in your browser. This window will close automatically.",
              method: "auto" as const,
              callback: async () => {
                const tokens = await callbackPromise
                stopOAuthServer()
                const accountId = extractCodexAccountId(tokens)
                return {
                  type: "success" as const,
                  refresh: tokens.refresh_token,
                  access: tokens.access_token,
                  expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  accountId,
                }
              },
            }
          },
        },
        {
          label: "Enter a code from ChatGPT",
          type: "oauth",
          authorize: async () => {
            const deviceResponse = await fetch(`${CODEX_ISSUER}/api/accounts/deviceauth/usercode`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": `opencode/${InstallationVersion}`,
              },
              body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
            })

            if (!deviceResponse.ok) throw new Error("Failed to initiate device authorization")

            const deviceData = (await deviceResponse.json()) as {
              device_auth_id: string
              user_code: string
              interval: string
            }
            const interval = Math.max(parseInt(deviceData.interval) || 5, 1) * 1000

            return {
              url: `${CODEX_ISSUER}/codex/device`,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto" as const,
              async callback() {
                while (true) {
                  const response = await fetch(`${CODEX_ISSUER}/api/accounts/deviceauth/token`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "User-Agent": `opencode/${InstallationVersion}`,
                    },
                    body: JSON.stringify({
                      device_auth_id: deviceData.device_auth_id,
                      user_code: deviceData.user_code,
                    }),
                  })

                  if (response.ok) {
                    const data = (await response.json()) as {
                      authorization_code: string
                      code_verifier: string
                    }

                    const tokens = await exchangeCodexCodeForTokens(
                      data.authorization_code,
                      `${CODEX_ISSUER}/deviceauth/callback`,
                      { verifier: data.code_verifier, challenge: "" },
                    )

                    return {
                      type: "success" as const,
                      refresh: tokens.refresh_token,
                      access: tokens.access_token,
                      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                      accountId: extractCodexAccountId(tokens),
                    }
                  }

                  if (response.status !== 403 && response.status !== 404) {
                    return { type: "failed" as const }
                  }

                  await sleep(interval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                }
              },
            }
          },
        },
        {
          label: "Paste an API key",
          type: "api",
        },
      ],
    },
    "chat.params": async (input, output) => {
      if (input.model.providerID !== "codex") return
      // Match codex cli
      output.maxOutputTokens = undefined
    },
  }
}
