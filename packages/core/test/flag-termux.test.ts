import { describe, expect, it } from "bun:test"
import { Flag, isTermux } from "../src/flag/flag"

describe("Termux & Antigravity flag detection", () => {
  const originalEnv = { ...process.env }

  function resetEnv() {
    process.env = { ...originalEnv }
  }

  it("detects Termux from TERMUX_VERSION", () => {
    resetEnv()
    delete process.env.TERMUX_VERSION
    delete process.env.PREFIX
    expect(isTermux()).toBe(process.platform === "android")

    process.env.TERMUX_VERSION = "0.118.0"
    expect(isTermux()).toBe(true)
    expect(Flag.OPENCODE_DISABLE_ANTIGRAVITY).toBe(true)

    resetEnv()
  })

  it("detects Termux from PREFIX containing com.termux", () => {
    resetEnv()
    delete process.env.TERMUX_VERSION
    process.env.PREFIX = "/data/data/com.termux/files/usr"
    expect(isTermux()).toBe(true)
    expect(Flag.OPENCODE_DISABLE_ANTIGRAVITY).toBe(true)

    resetEnv()
  })

  it("allows explicit OPENCODE_DISABLE_ANTIGRAVITY override", () => {
    resetEnv()
    // Explicit disable
    process.env.OPENCODE_DISABLE_ANTIGRAVITY = "true"
    expect(Flag.OPENCODE_DISABLE_ANTIGRAVITY).toBe(true)

    // Explicit enable even in Termux environment
    process.env.TERMUX_VERSION = "0.118.0"
    process.env.OPENCODE_DISABLE_ANTIGRAVITY = "false"
    expect(Flag.OPENCODE_DISABLE_ANTIGRAVITY).toBe(false)

    resetEnv()
  })
})
