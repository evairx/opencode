declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
}

// This fork is intentionally pinned. Keep the identity independent from the
// upstream build metadata so a bundled binary cannot silently rejoin updates.
export const InstallationVersion = "evairx-1.0"
export const InstallationChannel: string = "local"
export const InstallationLocal = true
