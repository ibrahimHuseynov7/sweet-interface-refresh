import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Bug,
  Clapperboard,
  Plane,
  ShoppingBag,
  ChevronLeft,
  RefreshCw,
  Mic,
  Square,
  Loader2,
  AudioLines,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoiceMode } from "@/components/voice-mode";
import travelImg from "@/assets/card-travel.png";
import cinemaImg from "@/assets/card-cinema.png";
import shoppingImg from "@/assets/card-shopping.png";
import { BirLogo } from "@/components/bir-logo";
import { AssistantReply } from "@/components/assistant-cards";
import { ThemeToggle } from "@/components/theme-toggle";
import { PipelineDebugger } from "@/components/pipeline-debugger";
import { assistantModules, assistantTurnStream } from "@/lib/chat.functions";
import { TurnProgress } from "@/components/turn-progress";
import type { ProgressStep } from "@/lib/turn-progress.types";
import { transcribeAudio } from "@/lib/stt.functions";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { synthesizeSpeech } from "@/lib/tts.functions";
import { useVoiceOutput } from "@/hooks/use-voice-output";
import type { Route as LogoCell } from "@/lib/bir";
import type { UI, UIEvent } from "@/lib/assistant/core/schemas";
import type { TurnResponse, TurnTrace } from "@/lib/assistant/core/turn";

export const Route = createFileRoute("/chat")({
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
    back: string;
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
    tts: {
      on: string;
      off: string;
      busy: string;
      failed: string;
      unsupported: string;
    };
  }
> = {
  az: {
    title: "Səyahət, kino və alış-veriş bir çatda",
    sub: "Nə lazımdırsa yazın və ya seçin.",
    hint: "İstənilən sualı verin...",
    error: "Cavab ala bilmədim.",
    back: "Əsas səhifəyə qayıt",
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
    tts: {
      on: "Səsli cavabları aç",
      off: "Səsli cavabları bağla",
      busy: "Cavabı səsləndirirəm…",
      failed: "Cavabı səsləndirə bilmədim.",
      unsupported: "Bu brauzer səs oxutmağı dəstəkləmir.",
    },
  },
  ru: {
    title: "Поездки, кино и покупки в одном чате",
    sub: "Напишите или выберите, что нужно.",
    hint: "Куда поехать без визы? Что идёт в кино сегодня?",
    error: "Не удалось получить ответ.",
    back: "На главную",
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
    tts: {
      on: "Включить голосовые ответы",
      off: "Выключить голосовые ответы",
      busy: "Озвучиваю ответ…",
      failed: "Не удалось озвучить ответ.",
      unsupported: "Этот браузер не может воспроизводить звук.",
    },
  },
  en: {
    title: "Trips, movies and shopping in one chat",
    sub: "Type or tap what you need.",
    hint: "Where can I go visa-free? What's on at the cinema tonight?",
    error: "Sorry, I couldn't get a reply.",
    back: "Back to the start page",
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
    tts: {
      on: "Turn on spoken replies",
      off: "Turn off spoken replies",
      busy: "Getting the reply ready to speak…",
      failed: "Couldn't play the reply aloud.",
      unsupported: "This browser can't play audio.",
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
  const tts = useServerFn(synthesizeSpeech);
  // What the voice view shows for the latest reply: the spoken summary once it is ready.
  const [voiceCaption, setVoiceCaption] = useState<{ id: number; text: string } | null>(null);
  const speaker = useVoiceOutput(
    useCallback(
      async (text: string, ctx?: { id: number; ui?: UI | undefined; request?: string | undefined }) => {
        const res = await tts({
          data: {
            text: text.slice(0, 5000),
            language: lang,
            request: ctx?.request?.slice(0, 2000),
            cards: ctx?.ui?.cards.slice(0, 40),
            quick_replies: ctx?.ui?.quick_replies
              .filter((q) => q.event.type !== "free_text")
              .map((q) => q.label.slice(0, 200))
              .slice(0, 20),
          },
        });
        if (ctx && res.spoken) setVoiceCaption({ id: ctx.id, text: res.spoken });
        return res;
      },
      [tts, lang],
    ),
  );
  const spokenRef = useRef<number | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const toggleMic = async () => {
    if (voice.status === "recording") return voice.stop();
    if (voice.status !== "idle") return;
    speaker.stop();
    const text = (await voice.start()).trim();
    if (text) {
      setInput((cur) => (cur.trim() ? `${cur.trim()} ${text}` : text).slice(0, 2000));
      inputRef.current?.focus();
    }
  };
  const t = T[lang];
  const lastUi = [...messages].reverse().find((m) => m.role === "assistant")?.ui;
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
  // Speak each new assistant reply only while the voice view is open and its speaker is on.
  // Replies that arrive in the regular chat are marked as handled, so they are never read out later.
  const speak = speaker.speak;
  useEffect(() => {
    const last = messages.at(-1);
    if (!last || last.role !== "assistant" || spokenRef.current === last.id) return;
    spokenRef.current = last.id;
    if (!voiceOpen) return;
    const request = [...messages].reverse().find((m) => m.role === "user")?.text;
    void speak(last.text, { id: last.id, ui: last.ui, request });
  }, [messages, speak, voiceOpen]);
  useEffect(() => {
    inputRef.current?.focus();
    void listModules()
      .then(setModules)
      .catch(() => setModules([]));
  }, [listModules]);

  const run = async (req: { message?: string; event?: UIEvent }, label: string) => {
    if (waiting) return;
    speaker.stop();
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
    speaker.stop();
    setMessages([]);
    setDebugId(null);
    setState(null);
    setFailed(null);
    setInput("");
  };

  const topicImg = (id: string) =>
    id === "cinema" ? cinemaImg : id === "shopping_assistant" ? shoppingImg : travelImg;
  const topicIcon = (id: string) =>
    id === "cinema" ? Clapperboard : id === "shopping_assistant" ? ShoppingBag : Plane;
  const pickModule = (m: { id: string; display_name: string }) =>
    sendEvent({ type: "select", slot: "module", value: m.display_name }, m.display_name);

  return (
    <div className="flex h-dvh justify-center bg-stage sm:items-center sm:py-6">
      <div className="phone-shell relative flex h-full w-full max-w-[440px] flex-col overflow-hidden sm:h-[min(920px,calc(100dvh-3rem))] sm:rounded-[2.75rem] sm:border sm:border-border">
        <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 pb-3 pt-5">
          <Link
            to="/"
            aria-label={t.back}
            title={t.back}
            onClick={() => speaker.stop()}
            className="icon-pill size-11 shrink-0"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold leading-tight">bir chat</p>
            <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" /> AI · online
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="icon-pill relative size-11 shrink-0 text-xs font-semibold focus-within:ring-2 focus-within:ring-ring">
              <span aria-hidden="true">{lang.toUpperCase()}</span>
              <select
                aria-label="Language"
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
                className="absolute inset-0 cursor-pointer appearance-none opacity-0"
              >
                <option value="az">AZ</option>
                <option value="ru">RU</option>
                <option value="en">EN</option>
              </select>
            </label>
            <ThemeToggle />
            <button
              type="button"
              onClick={reset}
              aria-label={t.newChat}
              title={t.newChat}
              className="icon-pill size-11"
            >
              <RefreshCw className="size-4" />
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 px-5 py-4">
            {!messages.length && (
              <div className="flex flex-col gap-6 pt-4">
                <div>
                  <h1 className="text-[2rem] font-bold leading-[1.1] tracking-tight">{t.title}</h1>
                  <p className="mt-3 text-base text-muted-foreground">{t.sub}</p>
                </div>
                <div className="grid grid-cols-2 grid-rows-[11rem_11rem] gap-3">
                  {modules.map((m, i) => {
                    const Icon = topicIcon(m.id);
                    return (
                      <button
                        type="button"
                        key={m.id}
                        disabled={waiting}
                        onClick={() => pickModule(m)}
                        className={`topic-card flex flex-col p-4 text-left disabled:opacity-60 ${i === 0 ? "row-span-2" : ""}`}
                      >
                        <span className="relative z-10 flex items-start justify-between gap-2">
                          <Icon className="size-4 text-primary" />
                          <span className="icon-pill size-8 shrink-0">
                            <ArrowUpRight className="size-3.5" />
                          </span>
                        </span>
                        <span className="relative z-10 mt-2 text-base font-semibold leading-snug">
                          {m.display_name}
                        </span>
                        <img
                          src={topicImg(m.id)}
                          alt=""
                          loading="lazy"
                          width={768}
                          height={768}
                          className={`pointer-events-none absolute object-contain ${i === 0 ? "-bottom-6 -left-4 h-[62%] w-auto" : "-bottom-5 -right-4 h-[62%] w-auto"}`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <div
                  key={m.id}
                  className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-3xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] text-primary-foreground"
                >
                  {m.text}
                </div>
              ) : (
                <div key={m.id} className="flex flex-col gap-3">
                  <div className="flex items-end gap-2">
                    <span className="icon-pill size-8 shrink-0">
                      <BirLogo
                        active={m.module ? (LOGO[m.module] ?? null) : null}
                        className="h-[16px] w-[10px] text-foreground"
                      />
                    </span>
                    <div className="w-fit max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-bl-md bg-card px-4 py-2.5 text-[15px]">
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
                      className="ml-9 h-7 w-fit gap-1.5 rounded-full px-2 text-xs text-muted-foreground"
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
          className="px-4 pb-5 pt-2"
        >
          {voice.status !== "idle" || voice.error ? (
            <p
              role={voice.error ? "alert" : "status"}
              className={`mb-2 px-3 text-xs ${voice.error ? "text-destructive" : "text-muted-foreground"}`}
            >
              {voice.error
                ? t.mic[voice.error]
                : voice.status === "recording"
                  ? t.mic.listening
                  : t.mic.busy}
            </p>
          ) : speaker.error || speaker.status === "loading" ? (
            <p
              role={speaker.error ? "alert" : "status"}
              className={`mb-2 px-3 text-xs ${speaker.error ? "text-destructive" : "text-muted-foreground"}`}
            >
              {speaker.error ? t.tts[speaker.error] : t.tts.busy}
            </p>
          ) : null}
          <div className="composer flex items-center gap-2 p-1.5 focus-within:border-primary">
            <Button
              size="icon"
              type="button"
              variant={speaker.enabled ? "default" : "secondary"}
              onClick={() => {
                if (!speaker.enabled) speaker.toggle();
                setVoiceOpen(true);
              }}
              aria-label={speaker.enabled ? t.tts.off : t.tts.on}
              aria-pressed={speaker.enabled}
              title={speaker.enabled ? t.tts.off : t.tts.on}
              className={`size-11 shrink-0 rounded-full ${speaker.status === "speaking" ? "animate-pulse" : ""}`}
            >
              {speaker.status === "loading" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <AudioLines className="size-4" />
              )}
            </Button>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={2000}
              aria-label="Message"
              placeholder={lastUi?.input_hint || t.hint}
              className="min-w-0 flex-1 bg-transparent px-1 text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <Button
              size="icon"
              type="button"
              variant={voice.status === "recording" ? "destructive" : "secondary"}
              onClick={() => void toggleMic()}
              disabled={waiting || voice.status === "transcribing"}
              aria-label={voice.status === "recording" ? t.mic.stop : t.mic.start}
              aria-pressed={voice.status === "recording"}
              title={voice.status === "recording" ? t.mic.stop : t.mic.start}
              className={`size-11 shrink-0 rounded-full ${voice.status === "recording" ? "animate-pulse" : ""}`}
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
              className="send-glow size-11 shrink-0 rounded-full"
            >
              <ArrowUp className="size-5" />
            </Button>
          </div>
        </form>
        {voiceOpen && (
          <VoiceMode
            lang={lang}
            micStatus={voice.status}
            speakerStatus={speaker.status}
            speakerOn={speaker.enabled}
            waiting={waiting}
            lastReply={(() => {
              const last = [...messages].reverse().find((m) => m.role === "assistant");
              return last && voiceCaption?.id === last.id ? voiceCaption.text : last?.text;
            })()}
            steps={steps}
            stepFallback={t.stages[stage] ?? t.stages[0]}
            lastUi={lastUi}
            onEvent={(e, label) => {
              if (e.type === "free_text") {
                // Typing happens in the chat composer, which is behind the voice view.
                speaker.stop();
                setVoiceOpen(false);
                setTimeout(() => inputRef.current?.focus(), 0);
                return;
              }
              sendEvent(e, label);
            }}
            onTypeOwn={() => {
              speaker.stop();
              setVoiceOpen(false);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            status={voice.error ? t.mic[voice.error] : speaker.error ? t.tts[speaker.error] : failed ? t.error : null}
            onSpeaker={speaker.toggle}
            onSend={sendText}
            onMic={async () => {
              if (voice.status === "recording") return voice.stop();
              if (voice.status !== "idle") return;
              speaker.stop();
              const text = (await voice.start()).trim();
              if (text) sendText(text);
            }}
            onClose={() => {
              speaker.stop();
              setVoiceOpen(false);
            }}
          />
        )}
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
