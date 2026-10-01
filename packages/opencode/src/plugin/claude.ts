import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { readStoredClaudeAuth, writeStoredClaudeAuth } from "@opencode-ai/core/claude"

export async function ClaudeAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "claude",
      methods: [
        {
          type: "oauth",
          label: "Claude Code (Subscription Pro/Max)",
          async authorize() {
            const stored = await readStoredClaudeAuth()
            if (stored?.access || stored?.token) {
              return {
                method: "auto",
                url: "https://claude.ai",
                instructions: "Detected active Claude Code subscription session.",
                async callback() {
                  return {
                    type: "success",
                    key: stored.access ?? stored.token!,
                  }
                },
              }
            }

            return {
              method: "code",
              url: "https://claude.ai",
              instructions: "Run 'claude setup-token' in your terminal and enter the token here:",
              async callback(code: string) {
                const token = code.trim()
                if (!token) return { type: "failed" }
                await writeStoredClaudeAuth({
                  type: token.startsWith("sk-ant-oat") ? "oauth" : "api",
                  access: token,
                  token,
                })
                return { type: "success", key: token }
              },
            }
          },
        },
        {
          type: "api",
          label: "Setup token or API key",
        },
      ],
    },
  }
}
