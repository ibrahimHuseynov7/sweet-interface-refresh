// Full-screen voice view (presentation only): reuses the page's existing mic, send and spoken-reply controls.
import { AudioLines, MessageSquareMore, MessageSquarePlus, Sparkles, Volume2, VolumeX, X, Loader2, Square } from "lucide-react";
import { AssistantReply } from "@/components/assistant-cards";
import { TurnProgress } from "@/components/turn-progress";
import type { ProgressStep } from "@/lib/turn-progress.types";
import type { UI, UIEvent } from "@/lib/assistant/core/schemas";

type Lang = "az" | "ru" | "en";
const COPY: Record<Lang, { title: string; say: string; tap: string; idle: string; listening: string; thinking: string; speaking: string; close: string; chat: string; examples: string[] }> = {
  az: {
    title: "Birbank assistenti · səs",
    say: "Məsələn, deyin",
    tap: "və ya toxunun",
    idle: "Danışmaq üçün düyməyə basın",
    listening: "Dinləyirəm…",
    thinking: "Düşünürəm…",
    speaking: "Cavab verirəm…",
    close: "Bağla",
    chat: "Çata qayıt",
    examples: ["Noyabr bayramlarına İstanbula iki nəfərlik bilet istəyirəm", "Bu axşam kinoda nəyə baxım?", "Bu axşam yaxınlıqda harada şam edim?"],
  },
  ru: {
    title: "bir chat · голос",
    say: "Например, скажите",
    tap: "или нажмите",
    idle: "Нажмите кнопку, чтобы говорить",
    listening: "Слушаю…",
    thinking: "Думаю…",
    speaking: "Отвечаю…",
    close: "Закрыть",
    chat: "Вернуться в чат",
    examples: ["Хочу два билета в Стамбул на ноябрьские праздники", "Что посмотреть в кино сегодня вечером?", "Найди мне беспроводные наушники"],
  },
  en: {
    title: "bir chat · voice",
    say: "For example, say",
    tap: "or tap",
    idle: "Tap the button to speak",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Replying…",
    close: "Close",
    chat: "Back to chat",
    examples: ["Two tickets to Istanbul for the November holidays", "What should I watch at the cinema tonight?", "Find me wireless headphones"],
  },
};

export function VoiceMode(props: {
  lang: Lang;
  micStatus: "idle" | "recording" | "transcribing";
  speakerStatus: "idle" | "loading" | "speaking";
  speakerOn: boolean;
  waiting: boolean;
  lastReply?: string | undefined;
  /** The latest assistant reply's UI (cards, quick replies, date picker), same as in the chat. */
  lastUi?: UI | undefined;
  /** Live "what the assistant is doing" steps while a reply is being prepared (shown, not spoken). */
  steps: ProgressStep[];
  stepFallback: string;
  onEvent: (e: UIEvent, label: string) => void;
  onTypeOwn: () => void;
  status?: string | null;
  onMic: () => void;
  onSpeaker: () => void;
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const c = COPY[props.lang];
  const ui = props.lastUi;
  const hasUi = !props.waiting && !!ui && (ui.cards.length > 0 || ui.quick_replies.length > 0);
  const active = props.micStatus === "recording" || props.speakerStatus === "speaking";
  const label =
    props.status ??
    (props.micStatus === "recording"
      ? c.listening
      : props.micStatus === "transcribing" || props.waiting || props.speakerStatus === "loading"
        ? c.thinking
        : props.speakerStatus === "speaking"
          ? c.speaking
          : c.idle);

  return (
    <div className="voice-stage absolute inset-0 z-30 flex flex-col">
      <header className="flex items-center gap-3 px-5 pt-5">
        <span className="flex size-12 items-center justify-center rounded-full border-2 border-primary text-primary">
          <MessageSquarePlus className="size-6" />
        </span>
        <p className="flex-1 truncate text-lg font-semibold">{c.title}</p>
        <button type="button" onClick={props.onClose} aria-label={c.close} className="send-glow flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <X className="size-5" />
        </button>
      </header>

      <div
        className={`relative flex flex-col items-center px-6 ${hasUi ? "shrink-0 pb-3 pt-2" : "min-h-0 flex-1 justify-center"}`}
      >
        <div className="voice-glow" aria-hidden="true" />
        <div
          className={`voice-wave ${active ? "voice-wave-active" : ""} ${hasUi ? "origin-center scale-50 -my-10" : ""}`}
          aria-hidden="true"
        >
          <span /><span /><span />
        </div>
        {props.waiting && !props.status ? (
          // Same live steps as in the chat ("Looking for tickets…"); shown only, never spoken.
          <div className="relative mt-10 flex w-full justify-center">
            <TurnProgress steps={props.steps} lang={props.lang} fallback={props.stepFallback} />
          </div>
        ) : (
          <>
            <p role="status" className={`relative ${hasUi ? "mt-0" : "mt-10"} text-center text-sm text-muted-foreground`}>{label}</p>
            {props.lastReply && (
              <p className={`relative mt-3 max-w-sm text-center ${hasUi ? "line-clamp-3" : "line-clamp-4"} text-[15px] leading-relaxed`}>{props.lastReply}</p>
            )}
          </>
        )}
      </div>

      {hasUi && ui ? (
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-3 px-4 pb-2">
            <AssistantReply
              ui={ui}
              onEvent={props.onEvent}
              onTypeOwn={props.onTypeOwn}
              live={!props.waiting}
              lang={props.lang}
            />
          </div>
        </div>
      ) : props.waiting ? null : (
      <div className="mx-4 rounded-[1.75rem] border border-border bg-card/80 p-4 backdrop-blur">
        <div className="mb-3 flex items-center gap-3 border-b border-border pb-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background"><Sparkles className="size-4" /></span>
          <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{c.say}</span>
          <span className="ml-auto text-sm text-muted-foreground">{c.tap}</span>
        </div>
        <div className="flex flex-col gap-2">
          {c.examples.map((e) => (
            <button key={e} type="button" disabled={props.waiting} onClick={() => props.onSend(e)} className="rounded-2xl border border-border bg-background/40 px-4 py-2.5 text-left text-[15px] transition-colors hover:bg-accent disabled:opacity-50">
              {e}
            </button>
          ))}
        </div>
      </div>
      )}

      <div className="flex shrink-0 items-center justify-around px-6 pb-7 pt-5">
        <button type="button" onClick={props.onSpeaker} aria-pressed={props.speakerOn} aria-label={props.speakerOn ? "Mute" : "Unmute"} className="icon-pill size-16">
          {props.speakerOn ? <Volume2 className="size-6" /> : <VolumeX className="size-6" />}
        </button>
        <button
          type="button"
          onClick={props.onMic}
          disabled={props.waiting || props.micStatus === "transcribing"}
          aria-label={props.micStatus === "recording" ? "Stop" : "Speak"}
          className={`send-glow flex size-24 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-primary/30 transition-transform active:scale-95 disabled:opacity-70 ${props.micStatus === "recording" ? "animate-pulse" : ""}`}
        >
          {props.micStatus === "recording" ? <Square className="size-7 fill-current" /> : props.micStatus === "transcribing" ? <Loader2 className="size-7 animate-spin" /> : <AudioLines className="size-8" />}
        </button>
        <button type="button" onClick={props.onClose} aria-label={c.chat} className="icon-pill size-16">
          <MessageSquareMore className="size-6" />
        </button>
      </div>
    </div>
  );
}
