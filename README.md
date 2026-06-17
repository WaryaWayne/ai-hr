# AI HR

Local AI employee performance reviews for coding agents.

AI HR scans local usage history from Codex, Claude Code, and OpenCode, normalizes token usage, estimates API-equivalent cost, and prints a report card for your AI coding workforce. The tone is playful, but the accounting is meant to stay clear: costs are estimates from local metadata and pricing rules, not provider invoices.

## Install

AI HR runs on Node.js. The CLI uses the Effect Node platform and reads OpenCode's local SQLite database through Node's built-in SQLite support.

```sh
npx ai-hr report --since 30d
```

You can also install it globally:

```sh
npm install -g ai-hr
ai-hr report --since 30d
```

The package exposes both `ai-hr` and `aihr` as command names.

## Usage

```sh
ai-hr
ai-hr scan --since 30d --sources codex,claude,opencode
ai-hr report --since 60d --format terminal
ai-hr payroll --since 30d
ai-hr leaderboard --group-by provider
ai-hr leaderboard --group-by model
ai-hr explain <session-id> --sources codex
ai-hr doctor
```

Useful flags:

| Flag | Default | Notes |
| --- | --- | --- |
| `--since` | `30d` | Duration such as `7d`, `30d`, or an ISO start date. |
| `--until` | none | Optional ISO end date. |
| `--sources` | `codex,claude,opencode` | Comma-separated list, or `all`. |
| `--format` | `terminal` | Supports `terminal`, `markdown`, `json`, and `html` for reports. |
| `--group-by` | `provider` | For leaderboard: `provider`, `model`, `repo`, or `day`. |

## What It Scans

AI HR reads local files and databases only:

| Source | Local path |
| --- | --- |
| Codex | `~/.codex/sessions` |
| Claude Code | `~/.claude/projects` |
| OpenCode | `~/.local/share/opencode/opencode.db` |

Core reports do not upload transcripts or usage data. Missing local stores simply produce empty results for that source.

## Reports

The terminal report includes:

- API-equivalent cost estimate
- monthly run-rate, or average monthly cost for 365-day windows
- highest spending day
- days without agent work
- context vs generated token mix
- employee roster by agent, including per-agent context ratio when multiple agents appear
- last-30-days activity trend for longer windows
- report-card grade, status, and context notes

The pricing notes section calls out approximation assumptions. Treat the totals as an API-equivalent model of local usage, not as a subscription bill or provider invoice.

## Related tools

AI HR is part of a small family of local-first tools for working with coding-agent history. They all read your local stores directly and never upload your data.

- [`codex-relink`](https://github.com/WaryaWayne/codex-relink) — a read-only helper for finding missing or hard-to-locate Codex CLI chats that match the current working directory, and printing the command needed to resume them.
- [`claude-relink`](https://github.com/WaryaWayne/claude-relink) — the same thing for Claude Code: it finds sessions matching the current working directory and prints the command needed to resume them.
- [`tailings`](https://github.com/WaryaWayne/tailings) — for when you want to gather a directory's *entire* agent history into the folder rather than resume one chat. It pulls the sessions and memories that Claude Code, Codex, OpenCode, and Gemini produced for the current directory into `./AGENTS.md` + `./.tailings/`, so the next agent — in any tool — is instantly caught up.

## Development

```sh
pnpm install
pnpm cli -- report --since 7d
pnpm build
pnpm test
```

The repo uses Effect 4 and keeps the Effect Language Service enabled for typecheck feedback.

## Publishing

```sh
pnpm test
pnpm build
pnpm publish:npm
```

The build writes `dist/cli.js` as a Node executable, and npm publishes that built CLI plus this README and license. `publish:npm` runs the build before publishing publicly and ignores lifecycle scripts so the Effect language-service patch step does not run during publish.
