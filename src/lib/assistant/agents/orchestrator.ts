// Prompt 1 - Orchestrator: routing decision only. Never talks to the user, never calls tools.
// Two models: Microsoft-Decision-1 (classifier) picks the module and the kind of turn, then gpt-6-luna
// fills the generative parts (slots, task, summary, ...) for that fixed route. If the router model is
// not configured or fails, Luna makes the whole decision on its own (the previous behaviour).
import { CONFIG, todayISO } from "../config";
import { decide, decisionConfigured, readChoice } from "../core/decision";
import type { LLMStats } from "../core/llm";
import { fill, ORCHESTRATOR_PROMPT, ROUTER_FIXED_NOTE } from "../core/prompts";
import { getEntry, moduleCards, type RegistryEntry, registry } from "../core/registry";
import { type Decision, DecisionSchema } from "../core/schemas";
import type { Session } from "../core/state";
import { runJSON } from "../core/validate";

export function compactState(s: Session) {
  return {
    user: s.user,
    active_topic_id: s.active_topic_id,
    topics: s.topics.map((t) => ({
      id: t.id,
      module: t.module,
      status: t.status,
      slots: t.slots,
      summary: t.summary,
      has_shown_results: !!t.last_result_ref,
    })),
    recent_turns: s.recent_turns,
    pending_intents: s.pending_intents,
  };
}

type Kind = "request" | "about_shown" | "out_of_scope";
export interface RouterPick {
  module: { value: string; confidence: number; fixed: boolean };
  kind: { value: Kind; confidence: number; fixed: boolean };
  probabilities: { module: Record<string, number>; kind: Record<string, number> };
  ms: number;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const moduleOption = (e: RegistryEntry) =>
  clip(
    `${e.display_name}: ${e.description}` +
      (e.use_when.length ? ` Use when: ${e.use_when.join("; ")}.` : "") +
      (e.not_when.length ? ` Not when: ${e.not_when.join("; ")}.` : ""),
    600,
  );

/** Asks Microsoft-Decision-1 which module this turn belongs to and what kind of turn it is. */
export async function runRouter(
  session: Session,
  userTurn: unknown,
): Promise<{ pick: RouterPick; calls: LLMStats[] } | null> {
  if (!decisionConfigured()) return null;
  const entries = registry();
  const moduleCriteria: Record<string, string> = Object.fromEntries(
    entries.map((e) => [e.id, moduleOption(e)]),
  );
  moduleCriteria["none"] =
    "None of the modules: greetings, small talk, or requests no module above can handle.";
  const active = session.topics.find((t) => t.id === session.active_topic_id);
  const state = {
    user_turn: userTurn,
    active_topic: active
      ? {
          module: active.module,
          summary: active.summary,
          has_shown_results: !!active.last_result_ref,
        }
      : null,
    parked_topics: session.topics
      .filter((t) => t.id !== session.active_topic_id)
      .map((t) => ({ module: t.module, summary: t.summary })),
    recent_turns: session.recent_turns.slice(-4),
    today: todayISO(),
  };
  try {
    const { answers, stats } = await decide(state, {
      module: {
        type: "choice",
        instructions:
          "Which assistant module should handle the user's latest turn (user_turn)? A short follow-up " +
          "(e.g. 'cheaper', 'earlier', a tapped option) belongs to the active topic's module.",
        criteria: moduleCriteria,
      },
      kind: {
        type: "choice",
        instructions: "What kind of turn is the user's latest turn (user_turn)?",
        criteria: {
          request:
            "Asks for something new or refines the current request (new search, filters, dates, a tapped option).",
          about_shown:
            "Asks about something already shown or said in the conversation; no new search needed.",
          out_of_scope: "Not a request any module can handle (small talk, unrelated topics).",
        },
      },
    });
    const min = CONFIG.decision.minConfidence();
    const m = readChoice(answers["module"], Object.keys(moduleCriteria));
    const k = readChoice(answers["kind"], ["request", "about_shown", "out_of_scope"]);
    if (!m || !k) throw new Error(`unexpected answers: ${JSON.stringify(answers).slice(0, 300)}`);
    const pick: RouterPick = {
      module: { value: m.choice, confidence: m.confidence, fixed: m.confidence >= min },
      kind: { value: k.choice as Kind, confidence: k.confidence, fixed: k.confidence >= min },
      probabilities: { module: m.probabilities, kind: k.probabilities },
      ms: stats.ms,
    };
    // "none" module and out_of_scope kind must agree before either is enforced.
    if (pick.module.fixed && pick.kind.fixed) {
      const noneMod = pick.module.value === "none";
      const oos = pick.kind.value === "out_of_scope";
      if (noneMod !== oos) {
        if (pick.module.confidence >= pick.kind.confidence) pick.kind.fixed = false;
        else pick.module.fixed = false;
      }
    }
    return { pick, calls: [stats] };
  } catch (e) {
    console.warn(`Router (Decision-1) failed, Luna routes alone: ${(e as Error).message}`);
    return null;
  }
}

/** Makes Luna's decision follow the router's fixed fields (code check after Luna's own retry). */
function enforce(d: Decision, pick: RouterPick | undefined): Decision {
  if (!pick) return d;
  const out = { ...d };
  if (pick.module.fixed) {
    if (pick.module.value === "none") {
      out.module = null;
      out.decision = "out_of_scope";
    } else if (getEntry(pick.module.value) && out.module !== pick.module.value) {
      const entry = getEntry(pick.module.value)!;
      const names = new Set([...entry.required_slots, ...entry.optional_slots].map((s) => s.name));
      out.module = pick.module.value;
      out.slots = Object.fromEntries(Object.entries(out.slots).filter(([k]) => names.has(k)));
      if (
        out.missing_slot &&
        out.missing_slot.name !== "module" &&
        !names.has(out.missing_slot.name)
      )
        out.missing_slot = null;
      if (out.decision === "out_of_scope") out.decision = "route";
    }
  }
  if (pick.kind.fixed && out.module) {
    if (pick.kind.value === "about_shown") out.decision = "answer_from_context";
    else if (pick.kind.value === "request" && out.decision !== "clarify") out.decision = "route";
  }
  if (
    pick.kind.fixed &&
    pick.kind.value === "out_of_scope" &&
    (!pick.module.fixed || pick.module.value === "none")
  ) {
    out.decision = "out_of_scope";
    out.module = null;
  }
  return out;
}

export async function runOrchestrator(session: Session, userTurn: unknown) {
  const router = await runRouter(session, userTurn);
  const pick = router?.pick;
  const system =
    fill(ORCHESTRATOR_PROMPT, { MODULE_CARDS: moduleCards(), TODAY: todayISO() }) +
    (pick ? ROUTER_FIXED_NOTE : "");
  const input = {
    user_turn: userTurn,
    state: compactState(session),
    today: todayISO(),
    ...(pick
      ? {
          router: {
            module: pick.module,
            kind: pick.kind,
          },
        }
      : {}),
  };
  const ids = registry().map((e) => e.id);
  const { value, raw, calls } = await runJSON<Decision>(
    "orchestrator",
    [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(input) },
    ],
    DecisionSchema,
    (d) => {
      const hard: string[] = [];
      if (d.module && !getEntry(d.module))
        hard.push(`module must be one of ${ids.join(", ")} or null`);
      if ((d.decision === "route" || d.decision === "answer_from_context") && !d.module)
        hard.push(`decision ${d.decision} needs a module`);
      if (d.decision === "clarify" && !d.module && d.missing_slot?.name !== "module")
        hard.push("clarify without module must ask for slot 'module'");
      if (d.resume_topic_id && !session.topics.some((t) => t.id === d.resume_topic_id))
        hard.push(`resume_topic_id ${d.resume_topic_id} does not exist`);
      return { hard, soft: [] };
    },
  );
  return {
    decision: enforce(value, pick),
    input,
    raw,
    calls: [...(router?.calls ?? []), ...calls],
    router: pick ?? null,
  };
}
