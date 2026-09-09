<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="evairx opencode logo">
    </picture>
  </a>
</p>
<p align="center"><b>evairx opencode</b> — a personal fork of the open source AI coding agent.</p>
<p align="center">
  <a href="https://github.com/evairx/opencode/releases"><img alt="Release" src="https://img.shields.io/badge/release-v1.0b-7c3aed?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode"><img alt="Upstream" src="https://img.shields.io/badge/upstream-anomalyco%2Fopencode-18181b?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> This repository is a **personal fork** created and maintained by [evairx](https://github.com/evairx).
> It is **not** the official OpenCode repository, nor does it represent official releases, support,
> or development decisions. The upstream project lives at
> [anomalyco/opencode](https://github.com/anomalyco/opencode), and every change in this repository
> is published only on [evairx/opencode](https://github.com/evairx/opencode).

---

## What is this?

A personal `opencode` build tuned for day-to-day agentic work. It adds extra providers, keeps the
whole terminal workflow intact, and makes the **Antigravity (agy)** provider behave like a first-class
citizen inside OpenCode.

Highlights:

- **Antigravity (agy)** — Google Gemini and more through the Antigravity CLI, with usage/cost tracking
  and per-session cost reporting.
- **Plugin-aware Antigravity** — agy brings its own integrated agent prompt, so OpenCode no longer
  injects its native system prompt on top. Skills and MCP servers still reach agy:
  - Name a skill (for example `caveman`) in your message and its instructions are embedded in the
    prompt automatically, because agy cannot call OpenCode's skill tool.
  - MCP servers configured in `opencode.json` (for example the `engram` memory server) are mirrored
    into agy (`agy mcp add`) so agy can execute them inside its own tool loop. Their tool events are
    rendered in the TUI like any other tool.
- **Codex (ChatGPT)** — native Codex provider with OAuth and the same usage dialog used by Antigravity.
- **CommandCode** — an additional model provider.
- **Usage dialog** — `/usage` and `Ctrl+P` → "Usage model" show plan quotas, buckets and spend.
- **TUI polish** — provider login popups, usage lander and assorted interface fixes.

> [!WARNING]
> The Antigravity integration shells out to the official `agy` CLI and uses only its
> documented `stream-json` protocol, with authentication owned by the `agy` keyring.
> That does **not** make it compliant with Google's consumer Terms of Service: the
> current Antigravity FAQ explicitly names third-party coding agents (including
> OpenCode) as unsupported with an Antigravity product login. For a third-party
> agent Google's recommended path is an API key through Vertex AI / AI Studio.
> Use at your own risk; this build does not evade detection, alter telemetry, or
> reuse extracted OAuth tokens.

[![OpenCode TUI](packages/web/src/assets/lander/screenshot.png)](https://github.com/evairx/opencode/releases)

[![OpenCode usage](packages/web/src/assets/lander/screenshot-usage.png)](https://github.com/evairx/opencode/releases)

---

## Installation

The installer downloads a **Windows x64** release and replaces your global `opencode` binary at
`~/.opencode/bin`. Your config files and plugins are preserved — the installer never touches them.
OpenCode then works exactly as before, but with this fork's providers.

**Plain `install.ps1` always installs the latest release** — no `-Version` needed. Pass
`-Version <x>` (for example `install.ps1 -Version 1.0b`) to pin a specific release, and `-Force` to
reinstall over a running/newer install.

**One line — PowerShell (CMD or PowerShell):**

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/evairx/opencode/dev/install.ps1 | iex"
```

**Or download and run it:**

```powershell
curl -fsSL -o install.ps1 https://raw.githubusercontent.com/evairx/opencode/dev/install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

**macOS / Linux (curl):**

```bash
curl -fsSL https://raw.githubusercontent.com/evairx/opencode/dev/install | bash
```

This fork publishes **Windows x64 binaries**; on macOS/Linux the `install` script points you to the
correct path. Binaries live under [Releases](https://github.com/evairx/opencode/releases).

> [!NOTE]
> Building from source is also supported: from `packages/opencode`, run
> `bun run script/build.ts --single` and copy `dist/opencode-windows-x64/bin/opencode.exe` over
> `~/.opencode/bin/opencode.exe`.

> [!WARNING]
> This fork ships its own providers (Antigravity, Codex, CommandCode, ...) and its own
> usage/credentials handling. When you connect a provider on this build, previously stored
> providers/credentials from the stock OpenCode build are not carried over. Your config files and
> plugins are always preserved.

---

## Agents

Two built-in agents are switchable with the `Tab` key:

- **build** — the default, full-access agent for development work.
- **plan** — a read-only agent for analysis and code exploration.
  - Denies file edits by default.
  - Asks permission before running shell commands.
  - Ideal for exploring unfamiliar codebases or planning changes.

A **general** subagent is used internally for complex searches and multi-step tasks and can be
invoked with `@general`.

---

## Documentation

Configuration is the same as upstream OpenCode: see the official [docs](https://opencode.ai/docs).

---

## Contributing

This is a personal fork — pull requests and issues go to [evairx/opencode](https://github.com/evairx/opencode).
For upstream work, read the upstream [contributing guide](https://github.com/anomalyco/opencode/blob/dev/CONTRIBUTING.md).

---

**Community** — upstream [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
