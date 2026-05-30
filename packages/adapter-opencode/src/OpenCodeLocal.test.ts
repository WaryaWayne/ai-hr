import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { rowsToUsageEvents } from "./OpenCodeNormalize"

describe("OpenCodeLocal", () => {
  it.effect("normalizes SQLite session rows into usage events", () =>
    Effect.gen(function*() {
      const events = yield* rowsToUsageEvents("/tmp/opencode.db", [
        {
          id: "opencode-session",
          directory: "/repo",
          title: "Fix checkout",
          time_created: 1780128000000,
          time_updated: 1780128600000,
          agent: "build",
          model: "anthropic/claude-sonnet-4-5",
          cost: 1.23,
          tokens_input: 1000,
          tokens_output: 200,
          tokens_reasoning: 50,
          tokens_cache_read: 300,
          tokens_cache_write: 400
        }
      ])

      expect(events).toHaveLength(1)
      expect(events[0]?.provider).toBe("opencode")
      expect(events[0]?.cacheReadTokens).toBe(300)
      expect(events[0]?.cacheWriteTokens).toBe(400)
    }))
})
