import fs from "node:fs"
import path from "node:path"
import { Global } from "./global"

export const COMMANDCODE_BASE_URL = "https://api.commandcode.ai/provider/v1"

export const COMMANDCODE_VARIANTS: Record<string, Record<string, unknown>> = {
  default: {},
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
  xhigh: { reasoningEffort: "xhigh" },
  max: { reasoningEffort: "max" },
}

export type CommandCodeModelDefinition = {
  id: string
  name: string
  family: string
  context: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  image?: boolean
  anthropic?: boolean
}

// Catálogo autogenerado desde https://commandcode.ai/docs/plans
export const COMMANDCODE_MODELS: CommandCodeModelDefinition[] = [
  {
    "id": "stealth/space-bunny-alpha",
    "name": "Space Bunny Alpha",
    "family": "stealth",
    "context": 1000000,
    "input": 0,
    "output": 0,
    "cacheRead": 0,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "stealth/pixel-canary",
    "name": "Pixel Canary",
    "family": "stealth",
    "context": 262144,
    "input": 0,
    "output": 0,
    "cacheRead": 0,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "poolside/laguna-s-2.1-free",
    "name": "Laguna S 2.1",
    "family": "laguna",
    "context": 256000,
    "input": 0,
    "output": 0,
    "cacheRead": 0,
    "cacheWrite": 0
  },
  {
    "id": "inclusionai/ling-3.0-flash-sante:free",
    "name": "Ling 3.0 Flash Sante",
    "family": "ling",
    "context": 262144,
    "input": 0,
    "output": 0,
    "cacheRead": 0,
    "cacheWrite": 0
  },
  {
    "id": "inclusionai/ling-3.1-flash:free",
    "name": "Ling 3.1 Flash",
    "family": "ling",
    "context": 262144,
    "input": 0,
    "output": 0,
    "cacheRead": 0,
    "cacheWrite": 0
  },
  {
    "id": "tencent/hy4-preview",
    "name": "Tencent Hy4 Preview",
    "family": "tencent",
    "context": 1048576,
    "input": 0.834,
    "output": 2.501,
    "cacheRead": 0.042,
    "cacheWrite": 0
  },
  {
    "id": "tencent/hy3-paid",
    "name": "Tencent Hy3",
    "family": "tencent",
    "context": 262144,
    "input": 0.14,
    "output": 0.58,
    "cacheRead": 0.035,
    "cacheWrite": 0
  },
  {
    "id": "moonshotai/Kimi-K3",
    "name": "Kimi K3",
    "family": "kimi",
    "context": 1000000,
    "input": 3,
    "output": 15,
    "cacheRead": 0.3,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "moonshotai/Kimi-K2.7-Code",
    "name": "Kimi K2.7 Code",
    "family": "kimi",
    "context": 256000,
    "input": 0.95,
    "output": 4,
    "cacheRead": 0.19,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "moonshotai/Kimi-K2.7-Code-Highspeed",
    "name": "Kimi K2.7 Code HighSpeed",
    "family": "kimi",
    "context": 262000,
    "input": 1.9,
    "output": 8,
    "cacheRead": 0.38,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "moonshotai/Kimi-K2.6",
    "name": "Kimi K2.6",
    "family": "kimi",
    "context": 256000,
    "input": 0.95,
    "output": 4,
    "cacheRead": 0.16,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "moonshotai/Kimi-K2.5",
    "name": "Kimi K2.5",
    "family": "kimi",
    "context": 256000,
    "input": 0.6,
    "output": 3,
    "cacheRead": 0.1,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "z-ai/glm-5.3-flash",
    "name": "GLM-5.3 Flash",
    "family": "glm",
    "context": 1048576,
    "input": 0.15,
    "output": 0.5,
    "cacheRead": 0.03,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "z-ai/glm-5.3-flashx",
    "name": "GLM-5.3 FlashX",
    "family": "glm",
    "context": 1000000,
    "input": 0.37,
    "output": 1.25,
    "cacheRead": 0.075,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "zai-org/GLM-5.3",
    "name": "GLM-5.3",
    "family": "glm",
    "context": 1000000,
    "input": 1.4,
    "output": 4.4,
    "cacheRead": 0.26,
    "cacheWrite": 0
  },
  {
    "id": "zai-org/GLM-5.2",
    "name": "GLM-5.2",
    "family": "glm",
    "context": 1000000,
    "input": 1.4,
    "output": 4.4,
    "cacheRead": 0.26,
    "cacheWrite": 0
  },
  {
    "id": "zai-org/GLM-5.2-Fast",
    "name": "GLM-5.2 Fast",
    "family": "glm",
    "context": 1000000,
    "input": 3,
    "output": 10.25,
    "cacheRead": 0.5,
    "cacheWrite": 0
  },
  {
    "id": "zai-org/GLM-5.1",
    "name": "GLM-5.1",
    "family": "glm",
    "context": 200000,
    "input": 1.4,
    "output": 4.4,
    "cacheRead": 0.26,
    "cacheWrite": 0
  },
  {
    "id": "zai-org/GLM-5",
    "name": "GLM-5",
    "family": "glm",
    "context": 200000,
    "input": 1,
    "output": 3.2,
    "cacheRead": 0.2,
    "cacheWrite": 0
  },
  {
    "id": "MiniMaxAI/MiniMax-M3",
    "name": "MiniMax M3",
    "family": "minimax",
    "context": 1000000,
    "input": 0.3,
    "output": 1.2,
    "cacheRead": 0.06,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "MiniMaxAI/MiniMax-M2.7",
    "name": "MiniMax M2.7",
    "family": "minimax",
    "context": 200000,
    "input": 0.3,
    "output": 1.2,
    "cacheRead": 0.06,
    "cacheWrite": 0
  },
  {
    "id": "MiniMaxAI/MiniMax-M2.5",
    "name": "MiniMax M2.5",
    "family": "minimax",
    "context": 200000,
    "input": 0.3,
    "output": 1.2,
    "cacheRead": 0.03,
    "cacheWrite": 0
  },
  {
    "id": "deepseek/deepseek-v4-pro",
    "name": "DeepSeek V4 Pro (latest)",
    "family": "deepseek",
    "context": 1000000,
    "input": 0.66,
    "output": 1.98,
    "cacheRead": 0.022,
    "cacheWrite": 0
  },
  {
    "id": "deepseek/deepseek-v4-flash",
    "name": "DeepSeek V4 Flash (latest)",
    "family": "deepseek",
    "context": 1000000,
    "input": 0.15,
    "output": 0.6,
    "cacheRead": 0.003,
    "cacheWrite": 0
  },
  {
    "id": "deepseek/deepseek-v4-flash-vision-exp",
    "name": "DeepSeek V4 Flash Vision (exp)",
    "family": "deepseek",
    "context": 1000000,
    "input": 0.15,
    "output": 0.6,
    "cacheRead": 0.003,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "deepseek/deepseek-v4-flash-fast",
    "name": "DeepSeek V4 Flash Fast",
    "family": "deepseek",
    "context": 1000000,
    "input": 0.28,
    "output": 0.56,
    "cacheRead": 0.07,
    "cacheWrite": 0
  },
  {
    "id": "deepseek/deepseek-v4.1-flash",
    "name": "DeepSeek V4.1 Flash",
    "family": "deepseek",
    "context": 1000000,
    "input": 0.15,
    "output": 0.6,
    "cacheRead": 0.003,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "deepseek/deepseek-v4.1-flash-fast",
    "name": "DeepSeek V4.1 Flash Fast",
    "family": "deepseek",
    "context": 1000000,
    "input": 0.16,
    "output": 0.58,
    "cacheRead": 0.016,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "Qwen/Qwen3.8-Omni-Flash",
    "name": "Qwen 3.8 Omni Flash",
    "family": "qwen",
    "context": 1000000,
    "input": 0.15,
    "output": 0.47,
    "cacheRead": 0.016,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "Qwen/Qwen3.8-Max-0902",
    "name": "Qwen 3.8 Max 0902",
    "family": "qwen",
    "context": 1000000,
    "input": 2,
    "output": 6,
    "cacheRead": 0.25,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "Qwen/Qwen3.8-Max",
    "name": "Qwen 3.8 Max",
    "family": "qwen",
    "context": 1000000,
    "input": 2,
    "output": 6,
    "cacheRead": 0.25,
    "cacheWrite": 2.5,
    "image": true
  },
  {
    "id": "Qwen/Qwen3.8-27B",
    "name": "Qwen 3.8 27B",
    "family": "qwen",
    "context": 262144,
    "input": 0.4,
    "output": 3,
    "cacheRead": 0.04,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "Qwen/Qwen3.6-Max-Preview",
    "name": "Qwen 3.6 Max Preview",
    "family": "qwen",
    "context": 200000,
    "input": 1.3,
    "output": 7.8,
    "cacheRead": 0.26,
    "cacheWrite": 1.63
  },
  {
    "id": "Qwen/Qwen3.6-Plus",
    "name": "Qwen 3.6 Plus",
    "family": "qwen",
    "context": 200000,
    "input": 0.5,
    "output": 3,
    "cacheRead": 0.1,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "Qwen/Qwen3.7-Max",
    "name": "Qwen 3.7 Max",
    "family": "qwen",
    "context": 1000000,
    "input": 2.5,
    "output": 7.5,
    "cacheRead": 0.5,
    "cacheWrite": 3.13
  },
  {
    "id": "Qwen/Qwen3.7-Plus",
    "name": "Qwen 3.7 Plus",
    "family": "qwen",
    "context": 1000000,
    "input": 0.4,
    "output": 1.6,
    "cacheRead": 0.08,
    "cacheWrite": 0.5,
    "image": true
  },
  {
    "id": "Qwen/Qwen3.8-Flash",
    "name": "Qwen 3.8 Flash",
    "family": "qwen",
    "context": 1000000,
    "input": 0.16,
    "output": 0.47,
    "cacheRead": 0.016,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "Qwen/Qwen3.7-Flash",
    "name": "Qwen 3.7 Flash",
    "family": "qwen",
    "context": 1000000,
    "input": 0.03,
    "output": 0.13,
    "cacheRead": 0.006,
    "cacheWrite": 0.038,
    "image": true
  },
  {
    "id": "meituan/LongCat-2.0",
    "name": "LongCat 2.0",
    "family": "longcat",
    "context": 1048576,
    "input": 0.3,
    "output": 1.2,
    "cacheRead": 0.006,
    "cacheWrite": 0
  },
  {
    "id": "stepfun/Step-5-Preview",
    "name": "Step 5 Preview",
    "family": "step",
    "context": 1000000,
    "input": 1,
    "output": 2.7,
    "cacheRead": 0.05,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "stepfun/Step-3.7-Flash",
    "name": "Step 3.7 Flash",
    "family": "step",
    "context": 256000,
    "input": 0.2,
    "output": 1.15,
    "cacheRead": 0.04,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "stepfun/Step-3.5-Flash",
    "name": "Step 3.5 Flash",
    "family": "step",
    "context": 262144,
    "input": 0.09,
    "output": 0.3,
    "cacheRead": 0.02,
    "cacheWrite": 0
  },
  {
    "id": "xiaomi/mimo-v2.6-pro",
    "name": "MiMo V2.6 Pro",
    "family": "mimo",
    "context": 1048576,
    "input": 0.435,
    "output": 0.87,
    "cacheRead": 0.0036,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "xiaomi/mimo-v2.6-pro-ultraspeed",
    "name": "MiMo V2.6 Pro UltraSpeed",
    "family": "mimo",
    "context": 1048576,
    "input": 4.35,
    "output": 8.7,
    "cacheRead": 0.036,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "xiaomi/mimo-v2.6-flash",
    "name": "MiMo V2.6 Flash",
    "family": "mimo",
    "context": 1048576,
    "input": 0.14,
    "output": 0.28,
    "cacheRead": 0.0028,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "xiaomi/mimo-v2.5-pro",
    "name": "MiMo V2.5 Pro",
    "family": "mimo",
    "context": 1000000,
    "input": 0.435,
    "output": 0.87,
    "cacheRead": 0.0036,
    "cacheWrite": 0
  },
  {
    "id": "xiaomi/mimo-v2.5",
    "name": "MiMo V2.5",
    "family": "mimo",
    "context": 1000000,
    "input": 0.14,
    "output": 0.28,
    "cacheRead": 0.0028,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "name": "Nemotron 3 Ultra",
    "family": "nemotron",
    "context": 1000000,
    "input": 0.6,
    "output": 2.4,
    "cacheRead": 0.12,
    "cacheWrite": 0
  },
  {
    "id": "claude-fable-5-1",
    "name": "Claude Fable 5.1",
    "family": "claude",
    "context": 1000000,
    "input": 10,
    "output": 50,
    "cacheRead": 0.25,
    "cacheWrite": 12.5,
    "image": true,
    "anthropic": true
  },
  {
    "id": "claude-fable-5",
    "name": "Claude Fable 5",
    "family": "claude",
    "context": 1000000,
    "input": 10,
    "output": 50,
    "cacheRead": 1,
    "cacheWrite": 12.5,
    "image": true,
    "anthropic": true
  },
  {
    "id": "claude-opus-5-5",
    "name": "Claude Opus 5.5",
    "family": "claude",
    "context": 1000000,
    "input": 4,
    "output": 20,
    "cacheRead": 0.2,
    "cacheWrite": 5,
    "image": true,
    "anthropic": true
  },
  {
    "id": "claude-opus-5",
    "name": "Claude Opus 5",
    "family": "claude",
    "context": 1000000,
    "input": 5,
    "output": 25,
    "cacheRead": 0.5,
    "cacheWrite": 6.25,
    "image": true,
    "anthropic": true
  },
  {
    "id": "claude-opus-4-8",
    "name": "Claude Opus 4.8",
    "family": "claude",
    "context": 1000000,
    "input": 5,
    "output": 25,
    "cacheRead": 0.5,
    "cacheWrite": 6.25,
    "image": true,
    "anthropic": true
  },
  {
    "id": "claude-opus-4-7",
    "name": "Claude Opus 4.7",
    "family": "claude",
    "context": 1000000,
    "input": 5,
    "output": 25,
    "cacheRead": 0.5,
    "cacheWrite": 6.25,
    "image": true,
    "anthropic": true
  },
  {
    "id": "claude-sonnet-5-5",
    "name": "Claude Sonnet 5.5",
    "family": "claude",
    "context": 1000000,
    "input": 2,
    "output": 10,
    "cacheRead": 0.2,
    "cacheWrite": 2.5,
    "image": true,
    "anthropic": true
  },
  {
    "id": "claude-sonnet-5",
    "name": "Claude Sonnet 5",
    "family": "claude",
    "context": 1000000,
    "input": 2,
    "output": 10,
    "cacheRead": 0.2,
    "cacheWrite": 2.5,
    "image": true,
    "anthropic": true
  },
  {
    "id": "claude-sonnet-4-6",
    "name": "Claude Sonnet 4.6",
    "family": "claude",
    "context": 1000000,
    "input": 3,
    "output": 15,
    "cacheRead": 0.3,
    "cacheWrite": 3.75,
    "image": true,
    "anthropic": true
  },
  {
    "id": "claude-haiku-4-5",
    "name": "Claude Haiku 4.5",
    "family": "claude",
    "context": 200000,
    "input": 1,
    "output": 5,
    "cacheRead": 0.1,
    "cacheWrite": 1.25,
    "image": true,
    "anthropic": true
  },
  {
    "id": "gpt-6-astra",
    "name": "GPT-6 Astra",
    "family": "gpt",
    "context": 1050000,
    "input": 10,
    "output": 50,
    "cacheRead": 1,
    "cacheWrite": 12.5,
    "image": true
  },
  {
    "id": "gpt-6.1-sol",
    "name": "GPT-6.1 Sol",
    "family": "gpt",
    "context": 1050000,
    "input": 2,
    "output": 10,
    "cacheRead": 0.1,
    "cacheWrite": 2.5,
    "image": true
  },
  {
    "id": "gpt-6-sol",
    "name": "GPT-6 Sol",
    "family": "gpt",
    "context": 1050000,
    "input": 2,
    "output": 10,
    "cacheRead": 0.2,
    "cacheWrite": 2.5,
    "image": true
  },
  {
    "id": "gpt-6-luna",
    "name": "GPT-6 Luna",
    "family": "gpt",
    "context": 1050000,
    "input": 0.1,
    "output": 0.5,
    "cacheRead": 0.01,
    "cacheWrite": 0.125,
    "image": true
  },
  {
    "id": "gpt-5.6-sol",
    "name": "GPT-5.6 Sol",
    "family": "gpt",
    "context": 1050000,
    "input": 5,
    "output": 30,
    "cacheRead": 0.5,
    "cacheWrite": 6.25,
    "image": true
  },
  {
    "id": "gpt-5.6-terra",
    "name": "GPT-5.6 Terra",
    "family": "gpt",
    "context": 1050000,
    "input": 2,
    "output": 12,
    "cacheRead": 0.2,
    "cacheWrite": 2.5,
    "image": true
  },
  {
    "id": "gpt-5.6-luna",
    "name": "GPT-5.6 Luna",
    "family": "gpt",
    "context": 1050000,
    "input": 0.2,
    "output": 1.2,
    "cacheRead": 0.02,
    "cacheWrite": 0.25,
    "image": true
  },
  {
    "id": "gpt-5.5",
    "name": "GPT-5.5",
    "family": "gpt",
    "context": 400000,
    "input": 5,
    "output": 30,
    "cacheRead": 0.5,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "gpt-5.4",
    "name": "GPT-5.4",
    "family": "gpt",
    "context": 400000,
    "input": 2.5,
    "output": 15,
    "cacheRead": 0.25,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "gpt-5.4-mini",
    "name": "GPT-5.4 Mini",
    "family": "gpt",
    "context": 400000,
    "input": 0.75,
    "output": 4.5,
    "cacheRead": 0.075,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "gpt-5.3-codex",
    "name": "GPT-5.3 Codex",
    "family": "gpt",
    "context": 400000,
    "input": 2,
    "output": 8,
    "cacheRead": 0.5,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "google/gemini-3.8-flash",
    "name": "Gemini 3.8 Flash",
    "family": "gemini",
    "context": 1000000,
    "input": 1.5,
    "output": 7.5,
    "cacheRead": 0.15,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "google/gemini-3.7-flash",
    "name": "Gemini 3.7 Flash",
    "family": "gemini",
    "context": 1048576,
    "input": 1.5,
    "output": 7.5,
    "cacheRead": 0.15,
    "cacheWrite": 0.08334,
    "image": true
  },
  {
    "id": "google/gemini-3.6-flash",
    "name": "Gemini 3.6 Flash",
    "family": "gemini",
    "context": 1000000,
    "input": 1.5,
    "output": 7.5,
    "cacheRead": 0.15,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "google/gemini-3.5-flash",
    "name": "Gemini 3.5 Flash",
    "family": "gemini",
    "context": 1000000,
    "input": 1.5,
    "output": 9,
    "cacheRead": 0.15,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "google/gemini-3.5-flash-lite",
    "name": "Gemini 3.5 Flash Lite",
    "family": "gemini",
    "context": 1000000,
    "input": 0.3,
    "output": 2.5,
    "cacheRead": 0.03,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "google/gemini-3.1-flash-lite",
    "name": "Gemini 3.1 Flash Lite",
    "family": "gemini",
    "context": 1000000,
    "input": 0.25,
    "output": 1.5,
    "cacheRead": 0.03,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "sakana/fugu-ultra",
    "name": "Fugu Ultra",
    "family": "fugu",
    "context": 1000000,
    "input": 5,
    "output": 30,
    "cacheRead": 0.5,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "meta/muse-spark-1.3",
    "name": "Muse Spark 1.3",
    "family": "muse",
    "context": 1048576,
    "input": 1.25,
    "output": 4.25,
    "cacheRead": 0.15,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "meta/muse-spark-1.3-contributor",
    "name": "Muse Spark 1.3 Contributor",
    "family": "muse",
    "context": 1048576,
    "input": 0.1,
    "output": 0.2,
    "cacheRead": 0.002,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "meta/muse-spark-1.2",
    "name": "Muse Spark 1.2",
    "family": "muse",
    "context": 1048576,
    "input": 1.25,
    "output": 4.25,
    "cacheRead": 0.15,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "meta/muse-spark-1.2-contributor",
    "name": "Muse Spark 1.2 Contributor",
    "family": "muse",
    "context": 1048576,
    "input": 0.1,
    "output": 0.2,
    "cacheRead": 0.002,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "meta/muse-spark-1.1",
    "name": "Muse Spark 1.1",
    "family": "muse",
    "context": 1048576,
    "input": 1.25,
    "output": 4.25,
    "cacheRead": 0.15,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "xai/grok-4.7",
    "name": "Grok 4.7",
    "family": "grok",
    "context": 500000,
    "input": 2,
    "output": 6,
    "cacheRead": 0.5,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "xai/grok-4.6",
    "name": "Grok 4.6",
    "family": "grok",
    "context": 500000,
    "input": 2,
    "output": 6,
    "cacheRead": 0.5,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "xai/grok-4.5",
    "name": "Grok 4.5",
    "family": "grok",
    "context": 500000,
    "input": 2,
    "output": 6,
    "cacheRead": 0.5,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "thinkingmachines/inkling",
    "name": "Inkling",
    "family": "inkling",
    "context": 256000,
    "input": 1,
    "output": 4.05,
    "cacheRead": 0.17,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "thinkingmachines/inkling-small",
    "name": "Inkling Small",
    "family": "inkling",
    "context": 1000000,
    "input": 0.5,
    "output": 1.2,
    "cacheRead": 0.1,
    "cacheWrite": 0,
    "image": true
  },
  {
    "id": "typesafe/jev",
    "name": "Jev",
    "family": "jev",
    "context": 32000,
    "input": 0.042,
    "output": 0,
    "cacheRead": 0,
    "cacheWrite": 0
  }
]

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
}

const PLAN_URLS: Record<string, string> = {
  pro: "https://commandcode.ai/docs/plans/pro",
  goat: "https://commandcode.ai/docs/plans/goat",
  go: "https://commandcode.ai/docs/plans/go",
}

export function inferCommandCodeFamily(id: string, vendor?: string, name?: string): string {
  const lowerId = id.toLowerCase()
  const lowerVendor = (vendor || "").toLowerCase()
  const lowerName = (name || "").toLowerCase()

  if (lowerId.includes("claude") || lowerName.includes("claude")) return "claude"
  if (lowerId.includes("deepseek") || lowerName.includes("deepseek")) return "deepseek"
  if (lowerId.includes("kimi") || lowerName.includes("kimi")) return "kimi"
  if (lowerId.includes("glm") || lowerName.includes("glm")) return "glm"
  if (lowerId.includes("minimax") || lowerName.includes("minimax")) return "minimax"
  if (lowerId.includes("qwen") || lowerName.includes("qwen")) return "qwen"
  if (lowerId.includes("step") || lowerName.includes("step")) return "step"
  if (lowerId.includes("mimo") || lowerName.includes("mimo")) return "mimo"
  if (lowerId.includes("nemotron") || lowerName.includes("nemotron")) return "nemotron"
  if (lowerId.includes("fugu") || lowerName.includes("fugu")) return "fugu"
  if (lowerId.includes("inkling") || lowerName.includes("inkling")) return "inkling"
  if (lowerId.includes("ling") || lowerName.includes("ling")) return "ling"
  if (lowerId.includes("gpt") || lowerName.includes("gpt")) return "gpt"
  if (lowerId.includes("gemini") || lowerName.includes("gemini")) return "gemini"
  if (lowerId.includes("grok") || lowerName.includes("grok")) return "grok"
  if (lowerId.includes("laguna") || lowerName.includes("laguna")) return "laguna"
  if (lowerId.includes("longcat") || lowerName.includes("longcat")) return "longcat"
  if (lowerId.includes("hy") || lowerName.includes("tencent") || lowerVendor.includes("tencent")) return "tencent"
  if (lowerId.includes("muse") || lowerName.includes("muse")) return "muse"
  if (lowerId.includes("jev")) return "jev"
  if (lowerVendor) return lowerVendor
  return "general"
}

function normalizeModel(m: Record<string, unknown>): CommandCodeModelDefinition {
  const id = String(m.id || m.slug || "")
  const name = String(m.name || id)
  const vendor = typeof m.vendor === "string" ? m.vendor : undefined
  const family = inferCommandCodeFamily(id, vendor, name)

  const parseCost = (val: unknown): number => {
    if (typeof val === "number") return val
    if (!val || val === "$undefined" || val === "—") return 0
    const num = parseFloat(String(val).replace(/[^0-9.]/g, ""))
    return isNaN(num) ? 0 : num
  }

  const isAnthropic = family === "claude" || id.startsWith("claude-") || id.startsWith("anthropic/")
  const caps = (m.caps && typeof m.caps === "object" ? m.caps : {}) as Record<string, unknown>
  const hasImage = Boolean(m.vision || caps.vision || m.image)

  const contextWindow =
    typeof m.contextWindow === "number"
      ? m.contextWindow
      : typeof m.context === "number"
        ? m.context
        : 128000

  return {
    id,
    name,
    family,
    context: contextWindow,
    input: parseCost(m.inputCost ?? m.input),
    output: parseCost(m.outputCost ?? m.output),
    cacheRead: parseCost(m.cacheReadCost ?? m.cacheRead),
    cacheWrite: parseCost(m.cacheWriteCost ?? m.cacheWrite),
    ...(hasImage ? { image: true } : {}),
    ...(isAnthropic ? { anthropic: true } : {}),
  }
}

function parseFromNextRsc(html: string): CommandCodeModelDefinition[] | null {
  const scriptRegex = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g
  for (const match of html.matchAll(scriptRegex)) {
    const rawChunk = match[1]
    if (rawChunk.includes('\\"models\\":[')) {
      try {
        const unescaped = JSON.parse(`"${rawChunk}"`)
        const colonIdx = unescaped.indexOf(":")
        const rscPayload = unescaped.slice(colonIdx + 1)
        const parsed = JSON.parse(rscPayload)
        if (parsed[3] && Array.isArray(parsed[3].models)) {
          return parsed[3].models.map(normalizeModel)
        }
      } catch {}
    }
  }
  return null
}

function parseFromHtmlTable(html: string): CommandCodeModelDefinition[] {
  const trMatches = [...html.matchAll(/<tr data-slot="table-row"[^>]*>([\s\S]*?)<\/tr>/g)]
  const models: CommandCodeModelDefinition[] = []

  for (let i = 1; i < trMatches.length; i++) {
    const row = trMatches[i][1]
    const linkMatch = row.match(
      /href="\/models\/([^"]+)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*truncate[^"]*"[^>]*>([^<]+)<\/span>/,
    )
    if (!linkMatch) continue

    const slug = linkMatch[1]
    const name = linkMatch[2].trim()

    const tds = [...row.matchAll(/<td data-slot="table-cell"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1])
    if (tds.length < 7) continue

    const contextText = tds[1].replace(/<[^>]+>/g, "").trim()
    let context = 128000
    if (contextText.endsWith("M")) context = parseFloat(contextText) * 1000000
    else if (contextText.endsWith("K")) context = parseFloat(contextText) * 1000

    const parsePrice = (tdHtml: string) => {
      const txt = tdHtml.replace(/<[^>]+>/g, "").trim()
      if (txt.toLowerCase() === "free" || txt === "—" || txt === "-") return 0
      const num = parseFloat(txt.replace(/[^0-9.]/g, ""))
      return isNaN(num) ? 0 : num
    }

    const inputPrice = parsePrice(tds[3])
    const outputPrice = parsePrice(tds[4])
    const cacheReadPrice = parsePrice(tds[5])
    const cacheWritePrice = parsePrice(tds[6])

    const capsMatch = tds[7] ? tds[7].match(/aria-label="Capabilities:\s*([^"]+)"/) : null
    const capsText = capsMatch ? capsMatch[1] : ""
    const hasVision = /vision|image/i.test(capsText)

    models.push(
      normalizeModel({
        id: slug,
        slug,
        name,
        context,
        input: inputPrice,
        output: outputPrice,
        cacheRead: cacheReadPrice,
        cacheWrite: cacheWritePrice,
        vision: hasVision,
        vendor: slug.split("-")[0],
      }),
    )
  }
  return models
}

async function fetchPage(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

export async function scrapeCommandCodeModels(
  plans: string[] = ["pro", "goat", "go"],
  timeoutMs = 8000,
): Promise<CommandCodeModelDefinition[]> {
  const modelMap = new Map<string, CommandCodeModelDefinition>()

  await Promise.all(
    plans.map(async (plan) => {
      const url = PLAN_URLS[plan] || `https://commandcode.ai/docs/plans/${plan}`
      try {
        const html = await fetchPage(url, timeoutMs)
        const parsed = parseFromNextRsc(html) || parseFromHtmlTable(html)
        for (const model of parsed) {
          if (!modelMap.has(model.id)) {
            modelMap.set(model.id, model)
          }
        }
      } catch {}
    }),
  )

  return Array.from(modelMap.values())
}

let memoryCache: CommandCodeModelDefinition[] | undefined

export function loadCachedCommandCodeModels(): { models: CommandCodeModelDefinition[]; isFresh: boolean } | undefined {
  if (memoryCache && memoryCache.length > 0) {
    return { models: memoryCache, isFresh: true }
  }
  try {
    const file = path.join(Global.Path.cache, "commandcode-models.json")
    if (!fs.existsSync(file)) return undefined
    const content = fs.readFileSync(file, "utf8")
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed) && parsed.length > 0) {
      memoryCache = parsed
      return { models: parsed, isFresh: false }
    }
    if (parsed && Array.isArray(parsed.models) && parsed.models.length > 0) {
      memoryCache = parsed.models
      const isFresh = Date.now() - (parsed.updatedAt || 0) < 1000 * 60 * 60 * 2 // 2 hours
      return { models: parsed.models, isFresh }
    }
  } catch {}
  return undefined
}

export function saveCachedCommandCodeModels(models: CommandCodeModelDefinition[]): void {
  try {
    memoryCache = models
    const file = path.join(Global.Path.cache, "commandcode-models.json")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ updatedAt: Date.now(), models }, null, 2), "utf8")
  } catch {}
}

export function getCommandCodeModels(): CommandCodeModelDefinition[] {
  const cached = loadCachedCommandCodeModels()
  if (cached?.models && cached.models.length > 0) return cached.models
  return COMMANDCODE_MODELS
}

export async function refreshCommandCodeModels(force = false): Promise<CommandCodeModelDefinition[]> {
  const cached = loadCachedCommandCodeModels()
  if (!force && cached?.isFresh) {
    return cached.models
  }

  const scraped = await scrapeCommandCodeModels().catch(() => [])
  if (scraped.length > 0) {
    saveCachedCommandCodeModels(scraped)
    return scraped
  }

  return cached?.models ?? COMMANDCODE_MODELS
}
