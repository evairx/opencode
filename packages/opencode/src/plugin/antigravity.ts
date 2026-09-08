import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { beginOAuth } from "@opencode-ai/core/antigravity"

export async function AntigravityAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "antigravity",
      methods: [
        {
          type: "oauth",
          label: "Google OAuth via Antigravity CLI",
          async authorize() {
            const session = await beginOAuth()
            return {
              method: "code",
              url: session.url,
              instructions: "Sign in with Google, then paste the authorization code returned by Antigravity.",
              async callback(code) {
                try {
                  await session.complete(code)
                  // Authentication itself is kept by agy in the system keyring.
                  // This marker lets OpenCode show the connected provider.
                  return { type: "success", key: "agy-cli-session" }
                } catch {
                  return { type: "failed" }
                } finally {
                  session.stop()
                }
              },
            }
          },
        },
      ],
    },
  }
}
