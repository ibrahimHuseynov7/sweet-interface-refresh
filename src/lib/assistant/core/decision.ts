// Microsoft-Decision-1 client (router model). Not a chat model: it takes a `state` (text or JSON) and typed
// questions (choice / score / noul) and returns numeric decisions. Docs:
// https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision
import { CONFIG } from "../config";
import type { LLMStats } from "./llm";

export type DecisionQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

export interface ChoiceAnswer {
  choice: string;
  /** Probability of the selected option (1 when the API did not return probabilities). */
  confidence: number;
  probabilities: Record<string, number>;
}
export interface DecisionResult {
  answers: Record<string, unknown>;
  stats: LLMStats;
}

export class DecisionError extends Error {}

export const decisionConfigured = () =>
  CONFIG.decision.enabled() && !!CONFIG.decision.apiKey() && !!CONFIG.decision.endpoint();

type DecideFn = (
  state: unknown,
  questions: Record<string, DecisionQuestion>,
) => Promise<DecisionResult>;

const callDecision: DecideFn = async (state, questions) => {
  const key = CONFIG.decision.apiKey();
  if (!key) throw new DecisionError("Decision API key is not set");
  const started = Date.now();
  let waited = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${CONFIG.decision.endpoint()}/providers/microsoft/v1/systemone`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "api-key": key },
      body: JSON.stringify({ model: CONFIG.decision.deployment(), state, questions }),
      signal: AbortSignal.timeout(CONFIG.decision.timeoutMs),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        answers?: Record<string, unknown>;
        usage?: { prompt_tokens?: number; input_tokens?: number; total_tokens?: number };
      };
      if (!data.answers || typeof data.answers !== "object")
        throw new DecisionError("Decision API returned no answers");
      return {
        answers: data.answers,
        stats: {
          role: "orchestrator",
          ms: Date.now() - started,
          attempts: attempt + 1,
          wait_ms: waited,
          effort: `decision:${CONFIG.decision.deployment()}`,
          prompt_tokens: data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? null,
          cached_tokens: null,
          completion_tokens: null,
          reasoning_tokens: null,
          tool_calls: 0,
        },
      };
    }
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      waited += 600 * (attempt + 1);
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    throw new DecisionError(`Decision API ${res.status}: ${text.slice(0, 300)}`);
  }
  throw new DecisionError("Decision API: too many retries");
};

let _decide: DecideFn = callDecision;
export const decide: DecideFn = (state, questions) => _decide(state, questions);
/** For tests. */
export function setDecider(fn: DecideFn | null) {
  _decide = fn ?? callDecision;
}

const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

/** Reads a `choice` answer. Tolerant of the exact field names for the per-option probabilities. */
export function readChoice(answer: unknown, options: string[]): ChoiceAnswer | null {
  if (!answer || typeof answer !== "object") return null;
  const a = answer as Record<string, unknown>;
  const choice = [a["choice"], a["answer"], a["value"], a["label"]].find(
    (v): v is string => typeof v === "string" && options.includes(v),
  );
  let probabilities: Record<string, number> = {};
  for (const k of ["probabilities", "probs", "distribution", "scores", "options"]) {
    const v = a[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const entries = Object.entries(v as Record<string, unknown>)
        .map(([o, p]) => [o, num(p)] as const)
        .filter((e): e is readonly [string, number] => e[1] !== null);
      if (entries.length) {
        probabilities = Object.fromEntries(entries);
        break;
      }
    }
  }
  const picked =
    choice ??
    Object.entries(probabilities)
      .filter(([o]) => options.includes(o))
      .sort((x, y) => y[1] - x[1])[0]?.[0];
  if (!picked) return null;
  return {
    choice: picked,
    confidence: probabilities[picked] ?? num(a["probability"]) ?? num(a["confidence"]) ?? 1,
    probabilities,
  };
}

/** Reads a `noul` answer: a probability from 0 to 1 that the statement is true. */
export function readNoul(answer: unknown): number | null {
  if (typeof answer === "number") return answer;
  if (!answer || typeof answer !== "object") return null;
  const a = answer as Record<string, unknown>;
  for (const k of ["probability", "p", "value", "score", "true"]) {
    const v = num(a[k]);
    if (v !== null) return v;
  }
  return null;
}
