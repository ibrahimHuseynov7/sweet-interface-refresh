// Server functions called by the chat UI. All AI calls, scraping and secrets stay on the server.
import { createServerFn } from "@tanstack/react-start";
import { RequestSchema } from "./assistant/core/schemas";

/** One assistant turn: Orchestrator -> Module Agent / direct adapter -> Responder (see src/lib/assistant). */
export const assistantTurn = createServerFn({ method: "POST" })
  .validator((d: unknown) => RequestSchema.parse(d))
  .handler(async ({ data }) => {
    const { warmUp } = await import("./scrapers.server");
    warmUp(); // keep the cinema / Birmarket snapshots fresh in the background
    const { handleTurn } = await import("./assistant/core/turn");
    return handleTurn(data);
  });

/** Enabled modules from the registry, for the welcome screen. */
export const assistantModules = createServerFn({ method: "GET" }).handler(async () => {
  const { registry } = await import("./assistant/core/registry");
  return registry().map((e) => ({ id: e.id, display_name: e.display_name }));
});

/**
 * Same turn as assistantTurn, streamed as NDJSON so the chat can show what the assistant is doing:
 * {"type":"step",...} lines while it works, then one {"type":"done","res":...} or {"type":"error"}.
 */
export const assistantTurnStream = createServerFn({ method: "POST" })
  .validator((d: unknown) => RequestSchema.parse(d))
  .handler(async ({ data }) => {
    const { warmUp } = await import("./scrapers.server");
    warmUp();
    const { handleTurn } = await import("./assistant/core/turn");
    const { withProgress } = await import("./turn-progress.server");
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: unknown) => {
          try {
            controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
          } catch {
            /* client went away */
          }
        };
        try {
          const res = await withProgress(
            (step) => send({ type: "step", step }),
            () => handleTurn(data),
          );
          send({ type: "done", res });
        } catch (e) {
          console.error("assistantTurnStream:", e);
          send({ type: "error" });
        } finally {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  });
