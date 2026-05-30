import { DateTime, Effect, Schema } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { normalizeCodexJsonLines } from "./CodexLocal"

const encodeJsonLine = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown))

describe("CodexLocal", () => {
  it.effect("normalizes token_count deltas and dedupes repeated cumulative totals", () =>
    Effect.gen(function*() {
      const fallbackDate = DateTime.makeUnsafe("2026-05-30T00:00:00.000Z")
      const events = yield* normalizeCodexJsonLines({
        filePath: "/tmp/codex.jsonl",
        sessionIdFallback: "session-1",
        fallbackDate,
        lines: [
          encodeJsonLine({ type: "session_meta", payload: { id: "session-1", cwd: "/repo", model: "gpt-5-codex" } }),
          encodeJsonLine({
            type: "event_msg",
            timestamp: "2026-05-29T12:00:00.000Z",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: { input_tokens: 1000, cached_input_tokens: 100, output_tokens: 50, reasoning_output_tokens: 25 },
                last_token_usage: { input_tokens: 1000, cached_input_tokens: 100, output_tokens: 50, reasoning_output_tokens: 25 }
              }
            }
          }),
          encodeJsonLine({
            type: "event_msg",
            timestamp: "2026-05-29T12:01:00.000Z",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: { input_tokens: 1000, cached_input_tokens: 100, output_tokens: 50, reasoning_output_tokens: 25 },
                last_token_usage: { input_tokens: 1000, cached_input_tokens: 100, output_tokens: 50, reasoning_output_tokens: 25 }
              }
            }
          }),
          encodeJsonLine({
            type: "event_msg",
            timestamp: "2026-05-29T12:02:00.000Z",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: { input_tokens: 1300, cached_input_tokens: 150, output_tokens: 80, reasoning_output_tokens: 40 },
                last_token_usage: { input_tokens: 300, cached_input_tokens: 50, output_tokens: 30, reasoning_output_tokens: 15 }
              }
            }
          })
        ]
      })

      expect(events).toHaveLength(2)
      expect(events[0]?.inputTokens).toBe(1000)
      expect(events[1]?.inputTokens).toBe(300)
      expect(events[1]?.cachedInputTokens).toBe(50)
    }))
})
