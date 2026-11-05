// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readChoice, readNoul, setDecider } from "@/lib/assistant/core/decision";
import { _azureChat, setLLM } from "@/lib/assistant/core/llm";
import { runOrchestrator } from "@/lib/assistant/agents/orchestrator";
import { newSession } from "@/lib/assistant/core/state";

describe("router (Microsoft-Decision-1 + Luna)", () => {
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  beforeAll(() => {
    process.env["AZURE_FOUNDRY_API_KEY"] = "k";
    process.env["ROUTER_DECISION_MODEL"] = "true";
    globalThis.fetch = (async (u: string, init?: RequestInit) => {
      urls.push(String(u));
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        model: "microsoft-decision-1",
        answers: {
          module: {
            type: "choice",
            choice: "shopping_assistant",
            probabilities: {
              shopping_assistant: 0.9,
              cinema: 0.05,
              travel_planner: 0.03,
              none: 0.02,
            },
          },
          kind: {
            type: "choice",
            choice: "request",
            probabilities: { request: 0.95, about_shown: 0.04, out_of_scope: 0.01 },
          },
        },
      });
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    setDecider(null);
    setLLM(_azureChat);
  });

  it("reads choice / noul answers", () => {
    expect(
      readChoice({ choice: "a", probabilities: { a: 0.7, b: 0.3 } }, ["a", "b"]),
    ).toMatchObject({
      choice: "a",
      confidence: 0.7,
    });
    expect(readChoice({ probabilities: { a: 0.2, b: 0.8 } }, ["a", "b"])?.choice).toBe("b");
    expect(readNoul({ type: "noul", probability: 0.4 })).toBe(0.4);
  });

  it("calls the systemone endpoint and forces Luna's module to the router's pick", async () => {
    setLLM(async () => ({
      role: "assistant",
      // Luna disagrees (cinema); the confident router pick wins and cinema-only slots are dropped.
      content: JSON.stringify({
        decision: "route",
        module: "cinema",
        slots: { query: "iphone", date: "today" },
        task: "t",
      }),
    }));
    const s = newSession({});
    const r = await runOrchestrator(s, "iphone 16");
    expect(urls[0]).toContain("/providers/microsoft/v1/systemone");
    expect(bodies[0]!["model"]).toBe("birchat-decision-1-test");
    expect(r.decision.module).toBe("shopping_assistant");
    expect(r.decision.slots["date"]).toBeUndefined();
    expect(r.router?.module.fixed).toBe(true);
  });
});
