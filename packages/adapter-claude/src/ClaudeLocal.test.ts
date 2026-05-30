import { DateTime, Effect, Schema } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { normalizeClaudeJsonLines } from "./ClaudeLocal"

const encodeJsonLine = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown))

describe("ClaudeLocal", () => {
  it.effect("normalizes assistant usage once per request", () =>
    Effect.gen(function*() {
      const fallbackDate = DateTime.makeUnsafe("2026-05-30T00:00:00.000Z")
      const assistant = {
        type: "assistant",
        timestamp: "2026-05-29T10:00:00.000Z",
        sessionId: "claude-session",
        requestId: "request-1",
        cwd: "/repo",
        message: {
          id: "msg-1",
          model: "claude-sonnet-4-5",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_creation_input_tokens: 40,
            cache_read_input_tokens: 60
          }
        }
      }
      const events = yield* normalizeClaudeJsonLines({
        filePath: "/tmp/claude.jsonl",
        sessionIdFallback: "claude-session",
        fallbackDate,
        lines: [encodeJsonLine(assistant), encodeJsonLine(assistant)]
      })

      expect(events).toHaveLength(1)
      expect(events[0]?.inputTokens).toBe(100)
      expect(events[0]?.cacheWriteTokens).toBe(40)
      expect(events[0]?.cacheReadTokens).toBe(60)
    }))
})
