// Trip date picker shown inside the chat when the assistant asks for travel dates.
// Round trip / one way, two months side by side on wide screens, opens on the month the user mentioned
// ("Novruz" -> March, with the holiday days marked). Sends {type:"date_picker", slot, value} where value is
// "YYYY-MM-DD/YYYY-MM-DD" (round trip) or "YYYY-MM-DD" (one way).
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { az, enUS, ru } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import type { UIEvent } from "@/lib/assistant/core/schemas";

export type PickerLang = "az" | "ru" | "en";

const L: Record<
  PickerLang,
  {
    round: string;
    oneway: string;
    depart: string;
    ret: string;
    choose: string;
    confirm: string;
    clear: string;
    tripType: string;
  }
> = {
  az: {
    round: "Gediş-dönüş",
    oneway: "Birtərəfli",
    depart: "Gediş",
    ret: "Dönüş",
    choose: "Seçin",
    confirm: "Biletləri göstər",
    clear: "Təmizlə",
    tripType: "Səfər növü",
  },
  ru: {
    round: "Туда и обратно",
    oneway: "В одну сторону",
    depart: "Туда",
    ret: "Обратно",
    choose: "Выберите",
    confirm: "Показать билеты",
    clear: "Сбросить",
    tripType: "Тип поездки",
  },
  en: {
    round: "Round trip",
    oneway: "One way",
    depart: "Departure",
    ret: "Return",
    choose: "Choose",
    confirm: "Show flights",
    clear: "Clear",
    tripType: "Trip type",
  },
};
const LOCALES = { az, ru, en: enUS };

/** "m=2027-03;mode=round;hl=2027-03-20..2027-03-24;name=Novruz;from=2027-03-20" -> fields. */
function parseDateHint(v: string | null | undefined) {
  const o: Record<string, string> = {};
  for (const part of (v ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) o[part.slice(0, i)] = part.slice(i + 1);
  }
  const hl = o["hl"]?.split("..");
  return {
    month: /^\d{4}-\d{2}$/.test(o["m"] ?? "") ? o["m"]! : null,
    mode:
      o["mode"] === "oneway"
        ? ("oneway" as const)
        : o["mode"] === "round"
          ? ("round" as const)
          : null,
    highlight: hl && hl.length === 2 ? { from: isoToDate(hl[0]!), to: isoToDate(hl[1]!) } : null,
    holiday: o["name"] ?? null,
    from: /^\d{4}-\d{2}-\d{2}$/.test(o["from"] ?? "") ? isoToDate(o["from"]!) : null,
  };
}
const isoToDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
};
const toIso = (d: Date) => format(d, "yyyy-MM-dd");

export function TripDatePicker({
  slot,
  hint,
  lang,
  onEvent,
}: {
  slot: string;
  hint?: string | null | undefined;
  lang: PickerLang;
  onEvent: (e: UIEvent, label: string) => void;
}) {
  const h = useMemo(() => parseDateHint(hint), [hint]);
  const t = L[lang];
  const locale = LOCALES[lang];
  const isMobile = useIsMobile();
  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);
  const [mode, setMode] = useState<"round" | "oneway">(h.mode ?? "round");
  const [range, setRange] = useState<DateRange | undefined>(
    h.from ? { from: h.from, to: undefined } : undefined,
  );
  const startMonth = h.month ? isoToDate(h.month + "-01") : (h.from ?? today);

  const fmt = (d?: Date) => (d ? format(d, "d MMM, EEE", { locale }) : t.choose);
  const ready = mode === "oneway" ? !!range?.from : !!range?.from && !!range?.to;
  const submit = () => {
    if (!range?.from) return;
    const from = range.from;
    if (mode === "oneway") {
      onEvent({ type: "date_picker", slot, value: toIso(from) }, format(from, "d MMM", { locale }));
      return;
    }
    if (!range.to) return;
    onEvent(
      { type: "date_picker", slot, value: `${toIso(from)}/${toIso(range.to)}` },
      `${format(from, "d MMM", { locale })} → ${format(range.to, "d MMM", { locale })}`,
    );
  };

  const common = {
    locale,
    weekStartsOn: 1 as const,
    numberOfMonths: isMobile ? 1 : 2,
    defaultMonth: startMonth,
    startMonth: new Date(today.getFullYear(), today.getMonth(), 1),
    disabled: { before: today },
    modifiers: h.highlight ? { holiday: h.highlight } : {},
    modifiersClassNames: { holiday: "trip-holiday" },
    className: "w-full bg-transparent p-0 [--cell-size:2.4rem]",
  };

  return (
    <div className="route-card flex w-full max-w-[680px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label={t.tripType} className="pill inline-flex p-1">
          {(["round", "oneway"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                if (m === "oneway" && range?.from) setRange({ from: range.from, to: undefined });
              }}
              className={`rounded-full px-3 py-1 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "round" ? t.round : t.oneway}
            </button>
          ))}
        </div>
        {h.holiday && h.highlight && (
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-primary" />
            {h.holiday} · {format(h.highlight.from, "d", { locale })}–
            {format(h.highlight.to, "d MMM", { locale })}
          </span>
        )}
      </div>

      <div className={`grid gap-2 ${mode === "round" ? "grid-cols-2" : "grid-cols-1"}`}>
        <div
          className={`rounded-lg border px-3 py-2 ${!range?.from ? "border-primary" : "border-border"}`}
        >
          <div className="text-[11px] text-muted-foreground">{t.depart}</div>
          <div className={`text-sm font-medium ${range?.from ? "" : "text-muted-foreground"}`}>
            {fmt(range?.from)}
          </div>
        </div>
        {mode === "round" && (
          <div
            className={`rounded-lg border px-3 py-2 ${range?.from && !range.to ? "border-primary" : "border-border"}`}
          >
            <div className="text-[11px] text-muted-foreground">{t.ret}</div>
            <div className={`text-sm font-medium ${range?.to ? "" : "text-muted-foreground"}`}>
              {fmt(range?.to)}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        {mode === "round" ? (
          <Calendar
            {...common}
            mode="range"
            selected={range}
            onSelect={(r) => setRange(r)}
            min={0}
          />
        ) : (
          <Calendar
            {...common}
            mode="single"
            selected={range?.from}
            onSelect={(d) => setRange(d ? { from: d, to: undefined } : undefined)}
          />
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        {range?.from && (
          <Button variant="ghost" size="sm" onClick={() => setRange(undefined)}>
            {t.clear}
          </Button>
        )}
        <Button onClick={submit} disabled={!ready} className="rounded-full px-5">
          <CalendarDays className="size-4" />
          {t.confirm}
        </Button>
      </div>
    </div>
  );
}
