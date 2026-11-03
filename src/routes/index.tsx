import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Bug,
  Clapperboard,
  Plane,
  ShoppingBag,
  Plus,
  MessageCircle,
  Mic,
  Square,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BirLogo } from "@/components/bir-logo";
import { AssistantReply } from "@/components/assistant-cards";
import { ThemeToggle } from "@/components/theme-toggle";
import { PipelineDebugger } from "@/components/pipeline-debugger";
import { assistantModules, assistantTurnStream } from "@/lib/chat.functions";
import { TurnProgress } from "@/components/turn-progress";
import type { ProgressStep } from "@/lib/turn-progress.types";
import { transcribeAudio } from "@/lib/stt.functions";
import { useVoiceInput } from "@/hooks/use-voice-input";
import type { Route as LogoCell } from "@/lib/bir";
import type { UI, UIEvent } from "@/lib/assistant/core/schemas";
import type { TurnResponse, TurnTrace } from "@/lib/assistant/core/turn";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bir Chat — trips, movies and shopping in one chat" },
      {
        name: "description",
        content:
          "Plan trips, find CinemaPlus sessions and Birmarket products by just typing what you need.",
      },
      { property: "og:title", content: "Bir Chat" },
      { property: "og:description", content: "Trips, movies and shopping in one chat." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Lang = "az" | "ru" | "en";
type Msg = {
  id: number;
  role: "user" | "assistant";
  text: string;
  ui?: UI;
  module?: string | null;
  trace?: TurnTrace | undefined;
};
// Logo highlight per module (cosmetic only; unknown modules simply show the full logo).
const LOGO: Record<string, LogoCell> = {
  travel_planner: "avia",
  cinema: "cinema",
  shopping_assistant: "shopping",
};
const T: Record<
  Lang,
  {
    title: string;
    sub: string;
    hint: string;
    error: string;
    newChat: string;
    retry: string;
    stages: [string, string, string];
    debugger: string;
    mic: {
      start: string;
      stop: string;
      listening: string;
      busy: string;
      denied: string;
      unsupported: string;
      failed: string;
    };
  }
> = {
  az: {
    title: "Səyahət, kino və alış-veriş bir çatda",
    sub: "Nə lazımdırsa yazın və ya seçin.",
    hint: "Novruzda vizasız hara gedim? Bu axşam kinoda nə var?",
    error: "Cavab ala bilmədim.",
    newChat: "Yeni çat",
    retry: "Yenidən cəhd et",
    stages: ["Düşünürəm…", "Məlumat axtarıram…", "Cavabı hazırlayıram…"],
    debugger: "Debuggerə bax",
    mic: {
      start: "Səslə yaz",
      stop: "Yazını dayandır",
      listening: "Dinləyirəm… bitirmək üçün ■ düyməsinə basın.",
      busy: "Mətnə çevirirəm…",
      denied: "Mikrofona icazə verin və yenidən cəhd edin.",
      unsupported: "Bu brauzer səs yazmağı dəstəkləmir.",
      failed: "Səsi tanıya bilmədim. Yenidən cəhd edin.",
    },
  },
  ru: {
    title: "Поездки, кино и покупки в одном чате",
    sub: "Напишите или выберите, что нужно.",
    hint: "Куда поехать без визы? Что идёт в кино сегодня?",
    error: "Не удалось получить ответ.",
    newChat: "Новый чат",
    retry: "Повторить",
    stages: ["Думаю…", "Ищу данные…", "Готовлю ответ…"],
    debugger: "Открыть отладчик",
    mic: {
      start: "Голосовой ввод",
      stop: "Остановить запись",
      listening: "Слушаю… нажмите ■, чтобы закончить.",
      busy: "Распознаю речь…",
      denied: "Разрешите доступ к микрофону и попробуйте снова.",
      unsupported: "Этот браузер не поддерживает запись голоса.",
      failed: "Не удалось распознать речь. Попробуйте снова.",
    },
  },
  en: {
    title: "Trips, movies and shopping in one chat",
    sub: "Type or tap what you need.",
    hint: "Where can I go visa-free? What's on at the cinema tonight?",
    error: "Sorry, I couldn't get a reply.",
    newChat: "New chat",
    retry: "Try again",
    stages: ["Thinking…", "Looking things up…", "Putting it together…"],
    debugger: "View Debugger",
    mic: {
      start: "Speak your message",
      stop: "Stop recording",
      listening: "Listening… tap ■ when you're done.",
      busy: "Turning speech into text…",
      denied: "Allow microphone access and try again.",
      unsupported: "This browser can't record audio.",
      failed: "Couldn't recognise that. Try again.",
    },
  },
};

function Index() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [state, setState] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("az");
  const [input, setInput] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState<{ message?: string; event?: UIEvent; label: string } | null>(
    null,
  );
  const [modules, setModules] = useState<{ id: string; display_name: string }[]>([]);
  const [stage, setStage] = useState(0);
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [debugId, setDebugId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const turnStream = useServerFn(assistantTurnStream);
  const listModules = useServerFn(assistantModules);
  const stt = useServerFn(transcribeAudio);
  const voice = useVoiceInput(
    useCallback(
      async (audio: string) => (await stt({ data: { audio, language: lang } })).text,
      [stt, lang],
    ),
  );
  const toggleMic = async () => {
    if (voice.status === "recording") return voice.stop();
    if (voice.status !== "idle") return;
    const text = (await voice.start()).trim();
    if (text) {
      setInput((cur) => (cur.trim() ? `${cur.trim()} ${text}` : text).slice(0, 2000));
      inputRef.current?.focus();
    }
  };
  const t = T[lang];
  const lastUi = [...messages].reverse().find((m) => m.role === "assistant")?.ui;
  const activeModule = [...messages].reverse().find((m) => m.module)?.module ?? null;
  const debugTurns = messages.flatMap((m) => (m.trace ? [{ id: m.id, trace: m.trace }] : []));

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, waiting]);
  // Progress text while a turn runs: routing -> data lookup -> writing the reply.
  useEffect(() => {
    if (!waiting) return setStage(0);
    const a = setTimeout(() => setStage(1), 2500);
    const b = setTimeout(() => setStage(2), 9000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [waiting]);
  useEffect(() => {
    inputRef.current?.focus();
    void listModules()
      .then(setModules)
      .catch(() => setModules([]));
  }, [listModules]);

  const run = async (req: { message?: string; event?: UIEvent }, label: string) => {
    if (waiting) return;
    setMessages((m) => [...m, { id: Date.now(), role: "user", text: label }]);
    setInput("");
    setFailed(null);
    setWaiting(true);
    setSteps([]);
    try {
      const res = await readTurnStream(
        await turnStream({
          data: { state, ...req, user: { language: lang, citizenship: "AZ", home_city: "Baku" } },
        }),
        (step) =>
          setSteps((cur) =>
            JSON.stringify(cur.at(-1)) === JSON.stringify(step) ? cur : [...cur, step],
          ),
      );
      setState(res.state);
      const ui = res.ui;
      if (ui)
        setMessages((m) => [
          ...m,
          {
            id: Date.now() + 1,
            role: "assistant",
            text: ui.text,
            ui,
            module: res.meta.module,
            trace: res.trace,
          },
        ]);
    } catch {
      setFailed({ ...req, label });
    } finally {
      setWaiting(false);
      inputRef.current?.focus();
    }
  };
  const sendText = (v: string) => {
    const text = v.trim().slice(0, 2000);
    if (text) void run({ message: text }, text);
  };
  const sendEvent = (event: UIEvent, label: string) => {
    if (event.type === "handoff_url") {
      if (event.value) window.open(event.value, "_blank", "noopener");
      return;
    }
    if (event.type === "free_text") {
      inputRef.current?.focus();
      return;
    }
    void run({ event }, label);
  };
  const reset = () => {
    setMessages([]);
    setDebugId(null);
    setState(null);
    setFailed(null);
    setInput("");
  };

  return (
    <div className="flex h-dvh bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-muted p-5 lg:flex">
        <div className="mb-10 flex items-center gap-3 text-primary">
          <BirLogo className="h-10 w-6" />
          <span className="font-display text-lg">bir chat</span>
        </div>
        <Button variant="outline" onClick={reset} className="justify-start bg-background">
          <Plus />
          {t.newChat}
        </Button>
        <nav className="mt-8 flex flex-col gap-2" aria-label="Chat topics">
          {modules.map((m) => {
            const Icon =
              m.id === "cinema"
                ? Clapperboard
                : m.id === "shopping_assistant"
                  ? ShoppingBag
                  : Plane;
            return (
              <Button
                key={m.id}
                variant="ghost"
                disabled={waiting}
                onClick={() =>
                  sendEvent(
                    { type: "select", slot: "module", value: m.display_name },
                    m.display_name,
                  )
                }
                className="h-auto min-h-10 justify-start whitespace-normal text-left text-muted-foreground"
              >
                <Icon />
                {m.display_name}
              </Button>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
          <MessageCircle className="size-4" />
          Bir Chat
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-[900px] items-center gap-2 px-4 py-4 sm:px-8">
            <Button
              variant="ghost"
              onClick={reset}
              className="h-auto gap-2 p-0 hover:bg-transparent"
            >
              <BirLogo
                active={activeModule ? (LOGO[activeModule] ?? null) : null}
                className="h-[34px] w-[21px]"
              />
              <span className="font-display text-base">bir chat</span>
            </Button>
            <select
              aria-label="Language"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="ml-auto h-9 rounded-lg border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="az">AZ</option>
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
            <ThemeToggle />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[900px] flex-col gap-6 px-4 py-6 sm:px-8">
            {!messages.length && (
              <div className="flex flex-col items-center gap-5 pb-8 pt-10 text-center sm:pt-20">
                <BirLogo className="h-[80px] w-[50px] text-primary" />
                <h1 className="font-display mt-2 text-3xl text-primary sm:text-4xl">bir chat</h1>
                <p className="max-w-md text-xl font-medium leading-relaxed sm:text-2xl">
                  {t.title}
                </p>
                <div className="mt-6 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
                  {modules.map((m) => {
                    const Icon =
                      m.id === "cinema"
                        ? Clapperboard
                        : m.id === "shopping_assistant"
                          ? ShoppingBag
                          : Plane;
                    return (
                      <Button
                        variant="outline"
                        key={m.id}
                        disabled={waiting}
                        onClick={() =>
                          sendEvent(
                            { type: "select", slot: "module", value: m.display_name },
                            m.display_name,
                          )
                        }
                        className="group h-auto min-h-28 flex-col items-start justify-between gap-4 whitespace-normal rounded-lg border-border p-4 text-left sm:min-h-36"
                      >
                        <Icon className="text-primary" />
                        <span className="flex w-full items-center justify-between gap-2">
                          <span>{m.display_name}</span>
                          <ArrowUpRight className="shrink-0 text-muted-foreground" />
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <div
                  key={m.id}
                  className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground"
                >
                  {m.text}
                </div>
              ) : (
                <div key={m.id} className="flex flex-col gap-3">
                  <div className="flex items-start gap-2">
                    <BirLogo
                      active={m.module ? (LOGO[m.module] ?? null) : null}
                      className="mt-1 h-[22px] w-[14px] shrink-0 text-foreground"
                    />
                    <div className="w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-wash px-4 py-2 text-sm">
                      {m.text}
                    </div>
                  </div>
                  {m.ui && (
                    <AssistantReply
                      ui={m.ui}
                      onEvent={sendEvent}
                      onTypeOwn={() => inputRef.current?.focus()}
                      live={m.ui === lastUi && !waiting}
                      lang={lang}
                    />
                  )}
                  {m.trace && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDebugId(m.id)}
                      className="ml-6 h-7 w-fit gap-1.5 px-2 text-xs text-muted-foreground"
                    >
                      <Bug className="size-3.5" />
                      {t.debugger}
                    </Button>
                  )}
                </div>
              ),
            )}
            {waiting && (
              <TurnProgress steps={steps} lang={lang} fallback={t.stages[stage] ?? t.stages[0]} />
            )}
            {failed && (
              <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
                {t.error}
                <Button
                  variant="link"
                  onClick={() => {
                    const f = failed;
                    setMessages((m) => m.slice(0, -1));
                    void run(
                      f.event ? { event: f.event } : { message: f.message ?? f.label },
                      f.label,
                    );
                  }}
                  className="underline"
                >
                  {t.retry}
                </Button>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </main>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendText(input);
          }}
          className="px-4 pb-5 pt-3 sm:px-8"
        >
          <div className="mx-auto max-w-[836px]">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card py-3 pl-4 pr-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={2000}
                aria-label="Message"
                placeholder={lastUi?.input_hint || t.hint}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <Button
                size="icon"
                type="button"
                variant={voice.status === "recording" ? "destructive" : "ghost"}
                onClick={() => void toggleMic()}
                disabled={waiting || voice.status === "transcribing"}
                aria-label={voice.status === "recording" ? t.mic.stop : t.mic.start}
                aria-pressed={voice.status === "recording"}
                title={voice.status === "recording" ? t.mic.stop : t.mic.start}
                className={`size-10 shrink-0 rounded-lg ${voice.status === "recording" ? "animate-pulse" : "text-muted-foreground"}`}
              >
                {voice.status === "recording" ? (
                  <Square className="size-4 fill-current" />
                ) : voice.status === "transcribing" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Mic className="size-4" />
                )}
              </Button>
              <Button
                size="icon"
                type="submit"
                aria-label="Send"
                disabled={waiting || !input.trim()}
                className="size-10 shrink-0 rounded-lg"
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
            {voice.status !== "idle" || voice.error ? (
              <p
                role={voice.error ? "alert" : "status"}
                className={`mt-2 text-xs ${voice.error ? "text-destructive" : "text-muted-foreground"}`}
              >
                {voice.error
                  ? t.mic[voice.error]
                  : voice.status === "recording"
                    ? t.mic.listening
                    : t.mic.busy}
              </p>
            ) : null}
            <div className="mt-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={reset}
                className="text-xs text-muted-foreground"
              >
                <Plus className="size-3" />
                {t.newChat}
              </Button>
            </div>
          </div>
        </form>
      </div>
      <PipelineDebugger
        turns={debugTurns}
        selected={debugId}
        onSelect={setDebugId}
        onClose={() => setDebugId(null)}
      />
    </div>
  );
}

/** Reads the NDJSON stream from assistantTurnStream: step lines, then the final turn result. */
async function readTurnStream(
  res: Response,
  onStep: (s: ProgressStep) => void,
): Promise<TurnResponse> {
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    buf += dec.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as
        | { type: "step"; step: ProgressStep }
        | { type: "done"; res: TurnResponse }
        | { type: "error" };
      if (msg.type === "step") onStep(msg.step);
      else if (msg.type === "done") return msg.res;
      else throw new Error("turn failed");
    }
    if (done) throw new Error("stream ended without a reply");
  }
}
