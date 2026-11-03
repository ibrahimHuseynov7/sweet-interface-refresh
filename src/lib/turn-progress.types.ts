// Shared by the server (turn-progress.server.ts) and the chat UI (components/turn-progress.tsx).
/** Language-neutral step; the browser turns it into AZ / RU / EN text. */
export type ProgressStep =
  | { key: "understanding" }
  | { key: "module"; module: string }
  | { key: "clarify" }
  | { key: "tool"; tool: string; args: Record<string, string> }
  | { key: "reviewing" }
  | { key: "writing" };
