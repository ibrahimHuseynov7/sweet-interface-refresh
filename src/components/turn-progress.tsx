// Live "what the assistant is doing" list shown while a reply is being prepared.
import { Check } from "lucide-react";
import type { ProgressStep } from "@/lib/turn-progress.types";

type Lang = "az" | "ru" | "en";
type Args = Record<string, string>;

const LOCALE: Record<Lang, string> = { az: "az-Latn-AZ", ru: "ru-RU", en: "en-GB" };

function fmtDate(v: string | undefined, lang: Lang): string {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);
  if (!m) return v;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1));
  try {
    return new Intl.DateTimeFormat(
      LOCALE[lang],
      m[3] ? { day: "numeric", month: "long" } : { month: "long", year: "numeric" },
    ).format(d);
  } catch {
    return v;
  }
}
const q = (s: string | undefined, lang: Lang) => (s ? (lang === "en" ? ` “${s}”` : ` «${s}»`) : "");
const route = (a: Args) =>
  a["origin"] && a["destination"] ? `: ${a["origin"]} → ${a["destination"]}` : "";
const on = (a: Args, lang: Lang, word: string) =>
  a["depart"] || a["date"] ? `${word}${fmtDate(a["depart"] ?? a["date"], lang)}` : "";

const L: Record<
  Lang,
  {
    understanding: string;
    clarify: string;
    reviewing: string;
    writing: string;
    module: Record<string, string>;
    moduleDefault: string;
    tool: Record<string, (a: Args) => string>;
    toolDefault: string;
  }
> = {
  az: {
    understanding: "Sorğunuzu anlayıram",
    clarify: "Sizə sual hazırlayıram",
    reviewing: "Variantları müqayisə edirəm",
    writing: "Cavabı yazıram",
    module: {
      travel_planner: "Səyahəti planlaşdırıram",
      cinema: "Kino seanslarına baxıram",
      shopping_assistant: "Birmarket-də axtarıram",
      weather: "Hava proqnozuna baxıram",
    },
    moduleDefault: "Lazımi bölməni açıram",
    tool: {
      search_flights: (a) => `Aviabilet qiymətlərini yoxlayıram${route(a)}${on(a, "az", ", ")}`,
      web_search: (a) => `İnternetdə axtarıram${q(a["query"], "az")}`,
      fetch_page: (a) => `Səhifəni oxuyuram${a["url"] ? `: ${a["url"]}` : ""}`,
      cinema_sessions: (a) =>
        `CinemaPlus seanslarını yoxlayıram${a["movie"] ? q(a["movie"], "az") : ""}${on(a, "az", ", ")}`,
      cinema_list: () => "Kinoteatrların siyahısını alıram",
      search_products: (a) => `Məhsul axtarıram${q(a["query"], "az")}`,
      get_product_details: () => "Məhsulun təfərrüatlarına baxıram",
      get_similar_products: () => "Oxşar məhsulları axtarıram",
      get_complementary_products: () => "Uyğun əlavə məhsullar axtarıram",
      get_bestsellers: () => "Ən çox satılanlara baxıram",
      get_suggestions: (a) => `Axtarışı dəqiqləşdirirəm${q(a["query"], "az")}`,
      get_product_offers: () => "Satıcıların qiymətlərini müqayisə edirəm",
      get_product_variations: () => "Mövcud variantları yoxlayıram",
    },
    toolDefault: "Məlumat toplayıram",
  },
  ru: {
    understanding: "Разбираю ваш запрос",
    clarify: "Готовлю уточняющий вопрос",
    reviewing: "Сравниваю варианты",
    writing: "Пишу ответ",
    module: {
      travel_planner: "Планирую поездку",
      cinema: "Смотрю сеансы в кино",
      shopping_assistant: "Ищу на Birmarket",
      weather: "Смотрю прогноз погоды",
    },
    moduleDefault: "Открываю нужный раздел",
    tool: {
      search_flights: (a) => `Проверяю цены на авиабилеты${route(a)}${on(a, "ru", ", ")}`,
      web_search: (a) => `Ищу в интернете${q(a["query"], "ru")}`,
      fetch_page: (a) => `Читаю страницу${a["url"] ? `: ${a["url"]}` : ""}`,
      cinema_sessions: (a) =>
        `Проверяю сеансы CinemaPlus${a["movie"] ? q(a["movie"], "ru") : ""}${on(a, "ru", ", ")}`,
      cinema_list: () => "Получаю список кинотеатров",
      search_products: (a) => `Ищу товары${q(a["query"], "ru")}`,
      get_product_details: () => "Смотрю подробности товара",
      get_similar_products: () => "Ищу похожие товары",
      get_complementary_products: () => "Подбираю сопутствующие товары",
      get_bestsellers: () => "Смотрю хиты продаж",
      get_suggestions: (a) => `Уточняю поиск${q(a["query"], "ru")}`,
      get_product_offers: () => "Сравниваю цены продавцов",
      get_product_variations: () => "Проверяю доступные варианты",
    },
    toolDefault: "Собираю данные",
  },
  en: {
    understanding: "Understanding your request",
    clarify: "Preparing a question for you",
    reviewing: "Comparing the options",
    writing: "Writing the answer",
    module: {
      travel_planner: "Planning your trip",
      cinema: "Looking at cinema sessions",
      shopping_assistant: "Searching Birmarket",
      weather: "Checking the weather forecast",
    },
    moduleDefault: "Opening the right section",
    tool: {
      search_flights: (a) => `Checking flight prices${route(a)}${on(a, "en", ", ")}`,
      web_search: (a) => `Searching the web for${q(a["query"], "en") || " details"}`,
      fetch_page: (a) => `Reading ${a["url"] ?? "a page"}`,
      cinema_sessions: (a) =>
        `Checking CinemaPlus sessions${a["movie"] ? ` for${q(a["movie"], "en")}` : ""}${on(a, "en", ", ")}`,
      cinema_list: () => "Getting the list of cinemas",
      search_products: (a) => `Searching products${a["query"] ? ` for${q(a["query"], "en")}` : ""}`,
      get_product_details: () => "Opening product details",
      get_similar_products: () => "Looking for similar products",
      get_complementary_products: () => "Finding items that go with it",
      get_bestsellers: () => "Checking the bestsellers",
      get_suggestions: (a) => `Refining the search${q(a["query"], "en")}`,
      get_product_offers: () => "Comparing sellers' prices",
      get_product_variations: () => "Checking available variants",
    },
    toolDefault: "Gathering information",
  },
};

function stepLabel(s: ProgressStep, lang: Lang): string {
  const l = L[lang];
  switch (s.key) {
    case "understanding":
    case "clarify":
    case "reviewing":
    case "writing":
      return l[s.key];
    case "module":
      return l.module[s.module] ?? l.moduleDefault;
    case "tool":
      return (l.tool[s.tool]?.(s.args) ?? l.toolDefault).trim();
  }
}

/** Steps so far: finished ones get a check mark, the last one shows the typing dots. */
export function TurnProgress({
  steps,
  lang,
  fallback,
}: {
  steps: ProgressStep[];
  lang: Lang;
  fallback: string;
}) {
  const labels = steps.map((s) => stepLabel(s, lang));
  const current = (labels.at(-1) ?? fallback).replace(/…$/, "");
  const done = labels.slice(0, -1);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={current}
      className="flex w-fit max-w-[85%] flex-col gap-1.5 rounded-2xl bg-wash px-4 py-3 text-xs"
    >
      {done.map((label, i) => (
        <span key={i} className="flex items-center gap-2 text-muted-foreground">
          <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
          {label}
        </span>
      ))}
      <span className="flex items-center gap-3">
        <span className="flex shrink-0 gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="typing-dot size-2 rounded-full bg-foreground"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </span>
        <span className="text-foreground">{current}…</span>
      </span>
    </div>
  );
}
