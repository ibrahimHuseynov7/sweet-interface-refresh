// Live progress for one assistant turn ("Checking flight prices: Baku → Istanbul…").
// The finished engine in src/lib/assistant is not modified: we observe it by wrapping its LLM function
// (setLLM) and route events to the right request with AsyncLocalStorage, so concurrent chats never mix.
import { AsyncLocalStorage } from "node:async_hooks";
import { _azureChat, setLLM, type ChatMessage, type LLMFn } from "./assistant/core/llm";
import type { ProgressStep } from "./turn-progress.types";

export type { ProgressStep };

interface Ctx {
  emit: (s: ProgressStep) => void;
  toolsRan: boolean;
}
const als = new AsyncLocalStorage<Ctx>();

// Only short, display-safe argument values are forwarded to the browser.
const SHOWN_ARGS = ["origin", "destination", "depart", "query", "city", "date", "movie", "url"];
function pickArgs(json: string): Record<string, string> {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(json || "{}") as Record<string, unknown>;
  } catch {
    /* keep empty */
  }
  const out: Record<string, string> = {};
  for (const k of SHOWN_ARGS) {
    const v = raw[k];
    if (typeof v !== "string" || !v.trim()) continue;
    if (k === "url") {
      try {
        out[k] = new URL(v).hostname.replace(/^www\./, "");
      } catch {
        /* skip bad urls */
      }
    } else out[k] = v.trim().slice(0, 60);
  }
  return out;
}

function moduleFromDecision(msg: ChatMessage): { decision?: string; module?: string | null } {
  try {
    const t = (msg.content ?? "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as {
      decision?: string;
      module?: string | null;
    };
  } catch {
    return {};
  }
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  const base: LLMFn = _azureChat;
  setLLM(async (role, messages, opts) => {
    const ctx = als.getStore();
    if (!ctx) return base(role, messages, opts);
    if (role === "orchestrator") ctx.emit({ key: "understanding" });
    else if (role === "module_agent" && ctx.toolsRan) ctx.emit({ key: "reviewing" });
    else if (role === "responder") ctx.emit({ key: "writing" });

    const out = await base(role, messages, opts);

    if (role === "orchestrator") {
      const d = moduleFromDecision(out);
      if (d.decision === "clarify") ctx.emit({ key: "clarify" });
      else if (d.module && (d.decision === "route" || d.decision === "answer_from_context"))
        ctx.emit({ key: "module", module: d.module });
    } else if (role === "module_agent" && out.tool_calls?.length) {
      ctx.toolsRan = true;
      for (const tc of out.tool_calls)
        ctx.emit({ key: "tool", tool: tc.function.name, args: pickArgs(tc.function.arguments) });
    }
    return out;
  });
}

/** Runs fn with progress events routed to emit (only for this request). */
export function withProgress<T>(emit: (s: ProgressStep) => void, fn: () => Promise<T>): Promise<T> {
  install();
  return als.run({ emit, toolsRan: false }, fn);
}
