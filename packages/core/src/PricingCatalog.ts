import { Context, Layer } from "effect"
import type { CostEstimate, PricingRule, Provider, UsageEvent } from "./Domain"

const million = 1_000_000

export class PricingCatalog extends Context.Service<PricingCatalog, {
  readonly rules: ReadonlyArray<PricingRule>
  readonly estimate: (event: UsageEvent) => CostEstimate
}>()("ai-hr/PricingCatalog") {}

const wildcardToRegExp = (pattern: string): RegExp =>
  new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "i")

const escapeRegExp = (input: string): string =>
  input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const matchesRule = (rule: PricingRule, provider: Provider, model: string): boolean =>
  rule.provider === provider && wildcardToRegExp(rule.modelPattern).test(model)

export const findPricingRule = (
  rules: ReadonlyArray<PricingRule>,
  provider: Provider,
  model: string
): PricingRule | undefined => rules.find((rule) => matchesRule(rule, provider, model))

export const estimateWithRules = (
  rules: ReadonlyArray<PricingRule>,
  event: UsageEvent
): CostEstimate => {
  const rule = findPricingRule(rules, event.provider, event.model)

  if (rule === undefined) {
    return {
      eventId: event.id,
      provider: event.provider,
      model: event.model,
      costUsd: 0,
      inputCostUsd: 0,
      outputCostUsd: 0,
      reasoningCostUsd: 0,
      cacheCostUsd: 0,
      warnings: [`No pricing rule matched ${event.provider}/${event.model}; event cost is excluded.`]
    }
  }

  const billableInputTokens = Math.max(0, event.inputTokens - event.cachedInputTokens)
  const inputCostUsd = billableInputTokens * rule.inputPerMillion / million
  const cachedCostUsd =
    event.cachedInputTokens * (rule.cachedInputPerMillion ?? rule.inputPerMillion) / million
  const outputCostUsd = event.outputTokens * rule.outputPerMillion / million
  const reasoningCostUsd =
    event.reasoningTokens * (rule.reasoningOutputPerMillion ?? rule.outputPerMillion) / million
  const cacheWriteCostUsd =
    event.cacheWriteTokens * (rule.cacheWritePerMillion ?? rule.inputPerMillion) / million
  const cacheReadCostUsd =
    event.cacheReadTokens * (rule.cacheReadPerMillion ?? rule.cachedInputPerMillion ?? rule.inputPerMillion) / million
  const cacheCostUsd = cachedCostUsd + cacheWriteCostUsd + cacheReadCostUsd
  const article = rule.confidence === "approximation" ? "an" : "a"
  const warnings = rule.confidence === "exact"
    ? [...rule.assumptions]
    : [`${rule.label} is ${article} ${rule.confidence} pricing match.`, ...rule.assumptions]

  return {
    eventId: event.id,
    provider: event.provider,
    model: event.model,
    costUsd: inputCostUsd + outputCostUsd + reasoningCostUsd + cacheCostUsd,
    inputCostUsd,
    outputCostUsd,
    reasoningCostUsd,
    cacheCostUsd,
    pricingRuleLabel: rule.label,
    sourceUrl: rule.sourceUrl,
    warnings
  }
}

export const manualPricingRules: ReadonlyArray<PricingRule> = [
  {
    provider: "codex",
    modelPattern: "gpt-5*",
    label: "OpenAI GPT-5 family API estimate",
    inputPerMillion: 1.25,
    cachedInputPerMillion: 0.125,
    outputPerMillion: 10,
    sourceUrl: "https://platform.openai.com/docs/pricing",
    confidence: "approximation",
    assumptions: ["Codex local usage is priced as API-equivalent OpenAI model tokens, not as a subscription invoice."]
  },
  {
    provider: "codex",
    modelPattern: "*codex*",
    label: "OpenAI Codex model API estimate",
    inputPerMillion: 1.25,
    cachedInputPerMillion: 0.125,
    outputPerMillion: 10,
    sourceUrl: "https://platform.openai.com/docs/pricing",
    confidence: "approximation",
    assumptions: ["Codex model aliases can move; verify current OpenAI pricing before treating this as exact."]
  },
  {
    provider: "claude",
    modelPattern: "*opus*",
    label: "Anthropic Claude Opus family API estimate",
    inputPerMillion: 15,
    cacheWritePerMillion: 18.75,
    cacheReadPerMillion: 1.5,
    outputPerMillion: 75,
    sourceUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing",
    confidence: "approximation",
    assumptions: ["Claude Code local usage is priced as API-equivalent Anthropic model tokens, not as a subscription invoice."]
  },
  {
    provider: "claude",
    modelPattern: "*sonnet*",
    label: "Anthropic Claude Sonnet family API estimate",
    inputPerMillion: 3,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
    outputPerMillion: 15,
    sourceUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing",
    confidence: "approximation",
    assumptions: ["Cache write/read pricing is modeled separately when transcript usage exposes it."]
  },
  {
    provider: "claude",
    modelPattern: "*haiku*",
    label: "Anthropic Claude Haiku family API estimate",
    inputPerMillion: 0.8,
    cacheWritePerMillion: 1,
    cacheReadPerMillion: 0.08,
    outputPerMillion: 4,
    sourceUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing",
    confidence: "approximation",
    assumptions: ["Haiku aliases are grouped by family for this first local report."]
  },
  {
    provider: "opencode",
    modelPattern: "*claude*sonnet*",
    label: "OpenCode Anthropic Sonnet routed estimate",
    inputPerMillion: 3,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
    outputPerMillion: 15,
    sourceUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing",
    confidence: "alias",
    assumptions: ["OpenCode stores local usage totals; this estimates provider API cost from the model name."]
  },
  {
    provider: "opencode",
    modelPattern: "*gpt-5*",
    label: "OpenCode OpenAI GPT-5 routed estimate",
    inputPerMillion: 1.25,
    cachedInputPerMillion: 0.125,
    outputPerMillion: 10,
    sourceUrl: "https://platform.openai.com/docs/pricing",
    confidence: "alias",
    assumptions: ["OpenCode provider routing is inferred from model text."]
  },
  {
    provider: "opencode",
    modelPattern: "*",
    label: "OpenCode unknown model fallback",
    inputPerMillion: 1.25,
    cachedInputPerMillion: 0.125,
    outputPerMillion: 10,
    sourceUrl: "https://platform.openai.com/docs/pricing",
    confidence: "approximation",
    assumptions: ["Fallback pricing is intentionally visible so users can replace it with an exact rule."]
  }
]

export const PricingCatalogLive = Layer.succeed(
  PricingCatalog,
  PricingCatalog.of({
    rules: manualPricingRules,
    estimate: (event) => estimateWithRules(manualPricingRules, event)
  })
)
