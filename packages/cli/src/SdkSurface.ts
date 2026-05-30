import { query } from "@anthropic-ai/claude-agent-sdk"
import { Codex } from "@openai/codex-sdk"
import { createOpencodeClient } from "@opencode-ai/sdk"

export const sdkSurfaceChecks = [
  ["OpenAI Codex SDK export", typeof Codex === "function"],
  ["Claude Agent SDK export", typeof query === "function"],
  ["OpenCode SDK export", typeof createOpencodeClient === "function"]
] as const
