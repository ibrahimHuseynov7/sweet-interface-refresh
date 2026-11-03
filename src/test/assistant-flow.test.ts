// @vitest-environment node
// End-to-end tests through the real pipeline AND the real data code (CineMastercard HTML parser,
// Travelpayouts flight client with arrival-time math, Birmarket parsing/search/live lookups).
// Only the network and the model are faked.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/assistant/core/llm";
import type { Product } from "@/lib/bir";

const CATALOG: Product[] = [
  {
    id: "101",
    name: "Çamadan Samsonite Cabin 55 sm",
    price_azn: 189,
    old_price: 229,
    rating: 4.8,
    reviews: 31,
    image_url: "https://img.test/1.jpg",
    url: "https://birmarket.az/product/101-camadan",
  },
  {
    id: "102",
    name: "Çamadan American Tourister 68 sm",
    price_azn: 145,
    old_price: null,
    rating: 4.5,
    reviews: 12,
    image_url: null,
    url: "https://birmarket.az/product/102-camadan",
  },
  {
    id: "201",
    name: "Smartfon Samsung Galaxy A55 8/256GB",
    price_azn: 799,
    old_price: null,
    rating: 4.9,
    reviews: 400,
    image_url: null,
    url: "https://birmarket.az/product/201-samsung",
  },
];
vi.mock("@/lib/scrapers.server", async (orig) => {
  const real = await orig<typeof import("@/lib/scrapers.server")>();
  // The background crawl is not run in tests; the catalog snapshot is given directly. Search logic is real.
  return { ...real, warmUp: () => {}, getBirmarketProducts: () => CATALOG };
});

const { setLLM, _azureChat } = await import("@/lib/assistant/core/llm");
const { handleTurn } = await import("@/lib/assistant/core/turn");
const { decodeState } = await import("@/lib/assistant/core/state");
const { todayISO } = await import("@/lib/assistant/config");
const { loadRegistry, moduleCards } = await import("@/lib/assistant/core/registry");
const { groundResult } = await import("@/lib/assistant/agents/module_agent");
const { newToolContext, mark } = await import("@/lib/assistant/tools/web");
const { parseBudget } = await import("@/lib/assistant/tools/money");
const { AGENT_ADAPTERS, DIRECT_ADAPTERS } = await import("@/lib/assistant/tools/adapters");
const { parseBirmarketHtml } = await import("@/lib/scrapers.server");
const REGISTRY_YAML = (await import("@/lib/assistant/registry.yaml")).default;

const TODAY = todayISO();
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
// A cinema page as cinemastercard.az serves it: one <tr data-date> per session (format used by parseCinemaHtml).
const row = (
  date: string,
  movie: string,
  href: string,
  time: string,
  hall: string,
  fmt: string,
  price: string,
) =>
  `<tr data-date="${dmy(date)}"><td><a href="${href}">${movie}</a></td><td>${time}</td><td>Deniz Mall</td><td>${hall}</td><td>Movie format: 2D Movie language: ${fmt} Movie with Aze subtitles</td><td>${price} AZN</td><td>Buy</td></tr>`;
const CINEMA_HTML = `<table>${row(TODAY, "Street Fighter", "/en/films/street-fighter/", "23:10", "4DX", "Rus", "18.00")}${row(TODAY, "Street Fighter", "/en/films/street-fighter/", "23:50", "Hall 3", "Tur", "6.00")}${row(TODAY, "Moana", "/en/films/moana/", "23:30", "Hall 2", "Rus", "6.00")}</table>`;

// Birmarket tag page as served: prices use a non-breaking space as thousands separator.
const bmLink = (id: string, name: string, prices: string) =>
  `<a href="/product/${id}-x" aria-label="${name}"><img src="https://img.test/${id}.jpg" alt="${name}">${prices} ${name} 4.8 69 reytinq</a>`;
const IPHONE_TAG_HTML = `<div>${bmLink("958296", "Smartfon Apple iPhone 16 8GB/128GB White", "-22% 1&nbsp;784.04 ₼ 2&nbsp;299.00 ₼")}${bmLink("945267", "Smartfon Apple iPhone 15 Dual Sim 128GB Black", "1\u00a0499.00 ₼")}${bmLink("777", "Çexol Apple iPhone 16 Silicone Case", "39.00 ₼")}</div>`;

// Flight rows as Travelpayouts returns them.
const tpRow = (o: Record<string, unknown>) => ({
  origin_airport: "GYD",
  destination_airport: "IST",
  return_at: null,
  transfers: 0,
  link: "/search/GYD2003IST1?t=x",
  ...o,
});
const GYD_IST = [
  tpRow({
    price: 120,
    airline: "J2",
    flight_number: "81",
    departure_at: "2027-03-20T09:30:00+04:00",
    duration_to: 150,
    link: "/search/GYD2003IST1?t=a",
  }),
  tpRow({
    price: 140,
    airline: "TK",
    flight_number: "335",
    departure_at: "2027-03-20T14:10:00+04:00",
    duration_to: 160,
    link: "/search/GYD2003IST1?t=b",
  }),
  tpRow({
    price: 95,
    airline: "PC",
    flight_number: "71",
    departure_at: "2027-03-20T23:40:00+04:00",
    duration_to: 400,
    transfers: 1,
    destination_airport: "SAW",
    link: "/search/GYD2003IST1?t=c",
  }),
];
const MIL_IST = [
  tpRow({
    origin_airport: "MXP",
    price: 110,
    airline: "TK",
    flight_number: "1874",
    departure_at: "2027-03-21T07:05:00+01:00",
    duration_to: 175,
    link: "/search/MIL2103IST1?t=m1",
  }),
  tpRow({
    origin_airport: "BGY",
    price: 70,
    airline: "PC",
    flight_number: "1218",
    departure_at: "2027-03-21T13:20:00+01:00",
    duration_to: 180,
    link: "/search/MIL2103IST1?t=m2",
  }),
  tpRow({
    origin_airport: "MXP",
    price: 90,
    airline: "TK",
    flight_number: "1876",
    departure_at: "2027-03-21T19:45:00+01:00",
    duration_to: 300,
    transfers: 1,
    link: "/search/MIL2103IST1?t=m3",
  }),
];
const AIRPORTS = [
  ["GYD", "Heydar Aliyev International Airport", "GYD", "AZ", "Asia/Baku"],
  ["IST", "Istanbul Airport", "IST", "TR", "Europe/Istanbul"],
  ["SAW", "Sabiha Gokcen", "IST", "TR", "Europe/Istanbul"],
  ["MXP", "Milan Malpensa", "MIL", "IT", "Europe/Rome"],
  ["LIN", "Milan Linate", "MIL", "IT", "Europe/Rome"],
  ["BGY", "Bergamo Orio al Serio", "MIL", "IT", "Europe/Rome"],
  ["FCO", "Leonardo da Vinci-Fiumicino", "ROM", "IT", "Europe/Rome"],
  ["CIA", "Ciampino", "ROM", "IT", "Europe/Rome"],
  ["LHR", "Heathrow", "LON", "GB", "Europe/London"],
  ["PVG", "Shanghai Pudong", "SHA", "CN", "Asia/Shanghai"],
].map(([code, name, city_code, country_code, time_zone]) => ({
  code,
  name,
  city_code,
  country_code,
  time_zone,
  iata_type: "airport",
  flightable: true,
}));
const PLACES: Record<string, unknown[]> = {
  baku: [{ type: "city", code: "GYD", name: "Baku", country_code: "AZ" }],
  gyd: [{ type: "city", code: "GYD", name: "Baku", country_code: "AZ" }],
  istanbul: [{ type: "city", code: "IST", name: "Istanbul", country_code: "TR" }],
  ist: [{ type: "city", code: "IST", name: "Istanbul", country_code: "TR" }],
  milan: [{ type: "city", code: "MIL", name: "Milan", country_code: "IT" }],
  london: [{ type: "city", code: "LON", name: "London", country_code: "GB" }],
  shanghai: [{ type: "city", code: "SHA", name: "Shanghai", country_code: "CN" }],
  fco: [
    {
      type: "airport",
      code: "FCO",
      name: "Leonardo da Vinci",
      city_code: "ROM",
      city_name: "Rome",
      country_code: "IT",
    },
  ],
};
// Rome -> Istanbul, Dec 3-5 (the screenshot case): no cached round trip, no FCO one-way on the exact day,
// but the city ROM has one-ways on Dec 3 (from FCO and CIA); IST -> ROM only cached on Dec 6 (per-day prices).
const ROME_OUT = [
  tpRow({
    origin_airport: "FCO",
    price: 98,
    airline: "TK",
    flight_number: "1862",
    departure_at: "2026-12-03T14:50:00+01:00",
    duration_to: 160,
    link: "/search/ROM0312IST1?t=r1",
  }),
  tpRow({
    origin_airport: "FCO",
    destination_airport: "SAW",
    price: 61,
    airline: "PC",
    flight_number: "1210",
    departure_at: "2026-12-03T13:10:00+01:00",
    duration_to: 165,
    link: "/search/ROM0312IST1?t=r2",
  }),
  tpRow({
    origin_airport: "CIA",
    price: 55,
    airline: "W4",
    flight_number: "7101",
    departure_at: "2026-12-03T06:00:00+01:00",
    duration_to: 170,
    link: "/search/ROM0312IST1?t=r3",
  }),
];
const ROME_BACK_DAYS = {
  "2026-12-06": tpRow({
    origin_airport: "IST",
    destination_airport: "FCO",
    price: 83,
    airline: "TK",
    flight_number: "1861",
    departure_at: "2026-12-06T12:10:00+03:00",
    duration_to: 170,
    link: "/search/IST0612ROM1?t=b1",
  }),
  "2026-12-20": tpRow({
    origin_airport: "IST",
    destination_airport: "FCO",
    price: 40,
    airline: "PC",
    flight_number: "1",
    departure_at: "2026-12-20T12:10:00+03:00",
    duration_to: 170,
    link: "/search/IST2012ROM1?t=b2",
  }),
};

// Baku <-> London round trip on Nov 3 -> Nov 11 (next such dates from today) and Shanghai -> Baku one way.
const TODAY0 = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku" }).format(new Date());
const nextYear = (mmdd: string) =>
  TODAY0 <= `${TODAY0.slice(0, 4)}-${mmdd}`
    ? Number(TODAY0.slice(0, 4))
    : Number(TODAY0.slice(0, 4)) + 1;
const YN = nextYear("11-03");
const LON_DEP = `${YN}-11-03`,
  LON_RET = `${YN}-11-11`;
const YD = nextYear("12-10");
const SHA_DEP = `${YD}-12-10`;
const ddmmOf = (iso: string) => iso.slice(8, 10) + iso.slice(5, 7);
const rtRow = (o: Record<string, unknown>) =>
  tpRow({
    destination_airport: "LHR",
    return_transfers: 0,
    duration_back: 360,
    link: `/search/GYD${ddmmOf(LON_DEP)}LON${ddmmOf(LON_RET)}1?t=rt`,
    ...o,
  });
// Exact round-trip fares (price covers both ways).
const GYD_LON_EXACT = [
  rtRow({
    price: 520,
    airline: "J2",
    flight_number: "71",
    departure_at: `${LON_DEP}T08:15:00+04:00`,
    return_at: `${LON_RET}T19:05:00+00:00`,
    duration_to: 405,
  }),
  rtRow({
    price: 410,
    airline: "TK",
    flight_number: "333",
    departure_at: `${LON_DEP}T06:30:00+04:00`,
    return_at: `${LON_RET}T11:40:00+00:00`,
    transfers: 1,
    return_transfers: 1,
    duration_to: 520,
    duration_back: 540,
  }),
];
// Same month: the exact fares again, one fare a day later each way (nearby), one far away (ignored).
const GYD_LON_MONTH = [
  ...GYD_LON_EXACT,
  rtRow({
    price: 455,
    airline: "PC",
    flight_number: "91",
    departure_at: `${YN}-11-04T21:00:00+04:00`,
    return_at: `${YN}-11-12T09:00:00+00:00`,
    transfers: 1,
    duration_to: 600,
  }),
  // Near Nov 12 -> 15 (no exact round-trip fare is cached for those days).
  rtRow({
    price: 308,
    airline: "VF",
    flight_number: "180",
    departure_at: `${YN}-11-10T05:50:00+04:00`,
    return_at: `${YN}-11-17T20:25:00+00:00`,
    transfers: 1,
    duration_to: 445,
  }),
  rtRow({
    price: 480,
    airline: "J2",
    flight_number: "7",
    departure_at: `${YN}-11-12T19:05:00+04:00`,
    return_at: `${YN}-11-14T22:05:00+00:00`,
    duration_to: 360,
  }),
  rtRow({
    price: 300,
    airline: "W6",
    flight_number: "1",
    departure_at: `${YN}-11-20T10:00:00+04:00`,
    return_at: `${YN}-11-27T10:00:00+00:00`,
    duration_to: 400,
  }),
];
const SHA_GYD = [
  tpRow({
    origin_airport: "PVG",
    destination_airport: "GYD",
    price: 610,
    airline: "MU",
    flight_number: "5",
    departure_at: `${SHA_DEP}T13:00:00+08:00`,
    duration_to: 720,
    transfers: 1,
    link: `/search/SHA${ddmmOf(SHA_DEP)}GYD1?t=s1`,
  }),
];
const GYD_SHA_WRONG_WAY = [
  tpRow({
    origin_airport: "GYD",
    destination_airport: "PVG",
    price: 1,
    airline: "XX",
    flight_number: "1",
    departure_at: `${SHA_DEP}T01:00:00+04:00`,
    duration_to: 600,
  }),
];

const realFetch = globalThis.fetch;
const fetched: string[] = [];
beforeAll(() => {
  process.env["COMPANY_AI_KEY"] = "test-key";
  process.env["TAVILY_API_KEY"] = "test";
  process.env["TRAVELPAYOUTS_TOKEN"] = "tp-test";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetched.push(url);
    if (url.startsWith("https://cinemastercard.az/en/cinema/about-cinemaplus/deniz-mall/"))
      return new Response(CINEMA_HTML, { headers: { "content-type": "text/html" } });
    if (url.startsWith("https://cinemastercard.az/en/cinema/about-cinemaplus/"))
      return new Response("<table></table>", { headers: { "content-type": "text/html" } });
    if (url.startsWith("https://autocomplete.travelpayouts.com/places2")) {
      const term = decodeURIComponent(url.split("term=")[1] ?? "").toLowerCase();
      return Response.json(PLACES[term] ?? []);
    }
    if (url === "https://api.travelpayouts.com/data/en/airports.json")
      return Response.json(AIRPORTS);
    if (url === "https://api.travelpayouts.com/data/en/airlines.json")
      return Response.json([
        { code: "J2", name: "Azerbaijan Airlines" },
        { code: "TK", name: "Turkish Airlines" },
        { code: "PC", name: "Pegasus" },
      ]);
    if (url.startsWith("https://open.er-api.com/"))
      return Response.json({ rates: { AZN: 1, USD: 0.588, EUR: 0.51 } });
    if (url.startsWith("https://api.travelpayouts.com/aviasales/v3/prices_for_dates")) {
      const q = new URL(url).searchParams;
      const og = q.get("origin"),
        ds = q.get("destination");
      if (["FCO", "ROM", "IST"].includes(og!) && ["FCO", "ROM", "IST"].includes(ds!)) {
        // Rome case: only city one-way outbound on Dec 3 is cached.
        const rows =
          og === "ROM" && !q.get("return_at") && q.get("departure_at") === "2026-12-03"
            ? ROME_OUT
            : [];
        return Response.json({
          data: q.get("direct") === "true" ? rows.filter((r) => r.transfers === 0) : rows,
        });
      }
      if (["LON", "SHA"].includes(og!) || ["LON", "SHA"].includes(ds!)) {
        const dep = q.get("departure_at"),
          ret = q.get("return_at");
        let rows: Record<string, unknown>[] = [];
        if (og === "GYD" && ds === "LON" && q.get("one_way") === "false")
          rows =
            dep === LON_DEP && ret === LON_RET
              ? GYD_LON_EXACT
              : dep === LON_DEP.slice(0, 7)
                ? GYD_LON_MONTH
                : [];
        // One-way legs on the user's exact days Nov 12 (out) and Nov 15 (back).
        if (og === "GYD" && ds === "LON" && q.get("one_way") === "true" && dep === `${YN}-11-12`)
          rows = [
            tpRow({
              destination_airport: "LHR",
              price: 190,
              airline: "J2",
              flight_number: "7",
              departure_at: `${YN}-11-12T19:05:00+04:00`,
              duration_to: 360,
            }),
          ];
        if (og === "LON" && ds === "GYD" && q.get("one_way") === "true" && dep === `${YN}-11-15`)
          rows = [
            tpRow({
              origin_airport: "LHR",
              destination_airport: "GYD",
              price: 170,
              airline: "J2",
              flight_number: "8",
              departure_at: `${YN}-11-15T22:05:00+00:00`,
              duration_to: 330,
            }),
          ];
        if (og === "SHA" && ds === "GYD") rows = SHA_GYD;
        if (og === "GYD" && ds === "SHA") rows = GYD_SHA_WRONG_WAY;
        return Response.json({
          data: q.get("direct") === "true" ? rows.filter((r) => r["transfers"] === 0) : rows,
        });
      }
      const rows = og === "MIL" ? MIL_IST : GYD_IST;
      return Response.json({
        data: q.get("direct") === "true" ? rows.filter((r) => r.transfers === 0) : rows,
      });
    }
    if (url.startsWith("https://api.travelpayouts.com/aviasales/v3/grouped_prices")) {
      const q = new URL(url).searchParams;
      const data =
        q.get("origin") === "IST" && q.get("departure_at") === "2026-12" ? ROME_BACK_DAYS : {};
      return Response.json({ success: true, data });
    }
    if (url.startsWith("https://api.tavily.com/search")) {
      const q = String(JSON.parse(String(init?.body))["query"]);
      const results = q.includes("visa")
        ? [
            {
              title: "Visa-free countries for Azerbaijan",
              url: "https://visa.test/az",
              content: "Turkey, Georgia, Montenegro",
            },
          ]
        : q.includes("hotel")
          ? [
              {
                title: "Istanbul hotels",
                url: "https://hotels.test/istanbul",
                content: "Hotel Sultan from 85 AZN per night. Grand Palace 400 AZN per night.",
              },
            ]
          : [];
      return Response.json({ results });
    }
    if (url === "https://visa.test/az")
      return new Response(
        "<title>Visa</title><p>Azerbaijani citizens: Turkey, Georgia visa-free.</p>",
        { headers: { "content-type": "text/html" } },
      );
    if (url.startsWith("https://birmarket.az/categories/")) {
      const cat = url.split("/categories/")[1]!;
      const pages: Record<string, string> = {
        "257-gozellik-ve-saglamliq":
          bmLink("5001", "Ətir Lancome La Vie Est Belle EDP 50 ml", "189.00 ₼") +
          bmLink("5002", "Fen Dyson Supersonic", "899.00 ₼") +
          bmLink("5003", "Qoruyucu şüşə test", "12.00 ₼"),
        "2266-aksessuarlar-saatlar-bezek-eshyalari":
          bmLink("6001", "Qol saatı Casio Sheen", "249.00 ₼") +
          bmLink("6002", "Sırğa gümüş 925", "79.00 ₼"),
        "106-meishet-texnikasi": bmLink("7001", "Kofe maşını DeLonghi Dedica", "429.00 ₼"),
      };
      return new Response(pages[cat] ?? "<div></div>", {
        headers: { "content-type": "text/html" },
      });
    }
    // The Birmarket catalog API is "down" here, so shopping uses the birmarket.az pages / snapshot.
    if (url.startsWith("https://mp-catalog.umico.az/"))
      return new Response("down", { status: 503 });
    if (url === "https://birmarket.az/tags/iphone")
      return new Response(IPHONE_TAG_HTML, { headers: { "content-type": "text/html" } });
    if (url.startsWith("https://birmarket.az/")) return new Response("not found", { status: 404 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

// ---------- scripted model ----------
type Step = (msgs: ChatMessage[]) => ChatMessage;
const queue: { orchestrator: Step[]; module_agent: Step[]; responder: Step[] } = {
  orchestrator: [],
  module_agent: [],
  responder: [],
};
const calls: { role: string; last: string; system: string }[] = [];
const json =
  (o: unknown): Step =>
  () => ({ role: "assistant", content: JSON.stringify(o) });
/** One model step with several tool calls (they run in parallel). */
const tools =
  (...list: [string, unknown][]): Step =>
  () => ({
    role: "assistant",
    content: null,
    tool_calls: list.map(([name, args]) => ({
      id: "c" + Math.random().toString(36).slice(2, 8),
      type: "function" as const,
      function: { name, arguments: JSON.stringify(args) },
    })),
  });
const tool = (name: string, args: unknown) => tools([name, args]);
/** Module Agent step that builds its answer from the actual tool results it received. */
const fromTools =
  (build: (results: Record<string, unknown>[]) => unknown): Step =>
  (msgs) => ({
    role: "assistant",
    content: JSON.stringify(
      build(msgs.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content ?? "{}"))),
    ),
  });
setLLM((role, messages) => {
  calls.push({
    role,
    last: String(messages.at(-1)?.content ?? ""),
    system: String(messages[0]?.content ?? ""),
  });
  const step = queue[role].shift();
  if (!step) throw new Error(`no scripted response for ${role}`);
  return Promise.resolve(step(messages));
});
const D = {
  topic_change: false,
  resume_topic_id: null,
  slots: {},
  missing_slot: null,
  task: "",
  topic_summary: "",
  new_pending_intents: [],
  reply_language: "en",
};
const user = { language: "en", citizenship: "AZ", home_city: "Baku" };
const attr = (c: { attributes?: Record<string, unknown> | undefined }, k: string) =>
  c.attributes?.[k];

describe("customer demo flow", () => {
  it("clarify -> results first -> flights with times -> cinema switch -> answer from context -> shopping", async () => {
    // Turn 1: "I want to travel" -> nothing known yet -> ONE question with options; "Type my own" last.
    queue.orchestrator.push(
      json({
        ...D,
        decision: "clarify",
        module: "travel_planner",
        topic_change: true,
        missing_slot: { name: "dates" },
        topic_summary: "Wants to travel.",
      }),
    );
    queue.responder.push(
      json({
        text: "When do you want to travel?",
        quick_replies: [
          {
            label: "Novruz holidays",
            event: { type: "select", slot: "dates", value: "Novruz holidays" },
          },
          { label: "Pick dates", event: { type: "select", slot: "dates", value: "Pick dates" } },
        ],
      }),
    );
    let r = await handleTurn({ message: "I want to travel", user });
    expect(r.meta.decision).toBe("clarify");
    expect(calls.length).toBe(2); // clarify skips the Module Agent
    expect(r.ui!.quick_replies[1]!.event).toEqual({ type: "date_picker", slot: "dates" });
    expect(r.ui!.quick_replies.at(-1)!.event.type).toBe("free_text");

    // Turn 2: tap "Novruz holidays". No exact days yet -> code asks again with the CALENDAR opened on March
    // (Novruz days marked). No search runs before the user picks the days.
    const NOVRUZ_Y = nextYear("03-20");
    queue.orchestrator.push(
      json({
        ...D,
        decision: "clarify",
        module: "travel_planner",
        slots: { dates: "Novruz holidays" },
        missing_slot: { name: "destination_or_criteria" },
        topic_summary: "Trip for Novruz.",
      }),
    );
    queue.responder.push(
      json({
        text: "Novruz is in March. Which days?",
        quick_replies: [
          {
            label: "Novruz holidays",
            event: { type: "select", slot: "dates", value: "Novruz holidays" },
          },
          { label: "Pick dates", event: { type: "select", slot: "dates", value: "Pick dates" } },
        ],
      }),
    );
    const agentCallsBefore = calls.filter((c) => c.role === "module_agent").length;
    r = await handleTurn({
      state: r.state,
      event: { type: "select", slot: "dates", value: "Novruz holidays" },
    });
    expect(r.meta.decision).toBe("clarify");
    expect(calls.filter((c) => c.role === "module_agent").length).toBe(agentCallsBefore);
    const picker = r.ui!.quick_replies.find((q) => q.event.type === "date_picker")!;
    expect(picker.event.slot).toBe("dates");
    expect(picker.event.value).toContain(`m=${NOVRUZ_Y}-03`);
    expect(picker.event.value).toContain(`hl=${NOVRUZ_Y}-03-20..${NOVRUZ_Y}-03-24`);
    expect(picker.event.value).toContain("name=Novruz");
    // The holiday chip is not offered again (the calendar is already on it).
    expect(r.ui!.quick_replies.some((q) => q.label === "Novruz holidays")).toBe(false);
    expect(r.ui!.quick_replies.at(-1)!.event.type).toBe("free_text");

    // Turn 2b: the user picks Mar 20 (one way) in the calendar. The Orchestrator wants to ask the destination
    // too, but that slot has a fallback -> code routes instead (results first) and asks ONE follow-up about it.
    queue.orchestrator.push(
      json({
        ...D,
        decision: "clarify",
        module: "travel_planner",
        slots: { dates: "Novruz holidays" }, // the model echoes the label: the picked day must stay
        missing_slot: { name: "destination_or_criteria" },
        topic_summary: "Trip for Novruz.",
      }),
    );
    queue.module_agent.push(
      tool("web_search", { query: "visa-free countries for Azerbaijan citizens" }),
    );
    const dest = (id: string, title: string, url: string) => ({
      id,
      kind: "destination",
      title,
      subtitle: "Visa-free",
      source_url: url,
      action: { label: "Plan this trip", type: "select", value: title },
    });
    queue.module_agent.push(
      json({
        status: "ok",
        summary: "Popular visa-free destinations.",
        items: [
          dest("d1", "Istanbul", "https://visa.test/az"),
          dest("d2", "Tbilisi", "https://visa.test/az"),
        ],
      }),
    );
    queue.responder.push(
      json({
        text: "Here are some popular ideas for Novruz. What kind of place do you like?",
        cards: [{ id: "d1" }, { id: "d2" }],
      }),
    );
    r = await handleTurn({
      state: r.state,
      event: { type: "date_picker", slot: "dates", value: `${NOVRUZ_Y}-03-20` },
    });
    expect(r.meta.decision).toBe("route");
    expect(r.ui!.cards.map((c) => c.id)).toEqual(["d1", "d2"]);
    expect(r.ui!.quick_replies.at(-1)!.event.type).toBe("free_text"); // the follow-up question has options
    expect(r.ui!.quick_replies[0]!.event).toEqual({
      type: "select",
      slot: "destination_or_criteria",
      value: "Visa-free options",
    });
    let s = (await decodeState(r.state))!;
    expect(s.topics[0]!.slots["dates"]).toBe(`${NOVRUZ_Y}-03-20`);
    expect(s.topics[0]!.assumed).toEqual({ destination_or_criteria: "popular destinations" });
    expect(calls.find((c) => c.role === "module_agent")!.system).toContain("previous_results");

    // Turn 3: "visa-free, no night flights" -> route; an item with an invented URL is dropped.
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        slots: {
          dates: "Novruz holidays",
          destination_or_criteria: "visa-free",
          constraints: "no night flights",
        },
        task: "Suggest 3 visa-free destinations from Baku.",
        topic_summary: "Visa-free Novruz trip, no night flights.",
      }),
    );
    queue.module_agent.push(
      tools(
        ["web_search", { query: "visa-free countries for Azerbaijan citizens" }],
        ["fetch_page", { url: "https://visa.test/az" }],
      ),
    );
    queue.module_agent.push(
      json({
        status: "ok",
        summary: "Novruz 2027 = 20-24 March.",
        items: [
          dest("d1", "Istanbul", "https://visa.test/az"),
          dest("d3", "Atlantis", "https://made-up.example/x"),
        ],
      }),
    );
    queue.responder.push(
      json({
        text: "Here are visa-free options for Novruz.",
        cards: [{ id: "d1", title: "Istanbul" }, { id: "d3" }],
      }),
    );
    r = await handleTurn({ state: r.state, message: "visa-free, no night flights" });
    expect(r.ui!.cards.map((c) => c.id)).toEqual(["d1"]); // invented-URL item dropped
    expect((await decodeState(r.state))!.topics[0]!.slots["dates"]).toBe(`${NOVRUZ_Y}-03-20`);
    expect(r.ui!.cards[0]!.price).toBeNull();
    expect(r.ui!.cards[0]!.action.event).toEqual({
      type: "select",
      slot: "destination",
      value: "Istanbul",
    });
    s = (await decodeState(r.state))!;
    expect(s.topics[0]!.assumed).toEqual({}); // the user answered the guessed slot

    // Turn 4: tap Istanbul -> flights + hotels in ONE parallel step; flights picked by ref (built in code).
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        slots: { destination: "Istanbul" },
        task: "Find flights Baku-Istanbul on 2027-03-20 and hotels.",
        topic_summary: "Visa-free Novruz trip; picked Istanbul.",
      }),
    );
    queue.module_agent.push(
      tools(
        [
          "search_flights",
          { origin: "Baku", destination: "Istanbul", depart: `${NOVRUZ_Y}-03-20`, adults: 1 },
        ],
        ["web_search", { query: "Istanbul hotels price per night March 2027" }],
      ),
    );
    queue.module_agent.push(
      fromTools((res) => {
        const f = res[0] as { options: { ref: string }[] };
        return {
          status: "ok",
          summary: "Flights and a hotel.",
          items: [
            ...f.options.map((o) => ({ ref: o.ref })),
            {
              id: "h1",
              kind: "hotel",
              title: "Hotel Sultan",
              attributes: { price_basis: "per night" },
              price: { amount: 85, currency: "AZN" },
              source_url: "https://hotels.test/istanbul",
              verify: true,
              action: {
                label: "Book on site",
                type: "handoff_url",
                value: "https://hotels.test/istanbul",
              },
            },
          ],
        };
      }),
    );
    queue.responder.push(
      json({ text: "Flights from 95 USD and Hotel Sultan from 85 AZN per night.", cards: [] }),
    );
    r = await handleTurn({
      state: r.state,
      event: { type: "select", slot: "destination", value: "Istanbul" },
    });
    expect(
      fetched.some(
        (u) =>
          u.includes("prices_for_dates") &&
          u.includes("origin=GYD") &&
          u.includes("destination=IST"),
      ),
    ).toBe(true);
    const flights = r.ui!.cards.filter((c) => c.kind === "flight");
    expect(flights.length).toBe(3); // several options, direct AND with a stop
    // Sorted by departure time; arrival in the destination's time zone (09:30 +04 + 150 min = 11:00 Istanbul).
    expect(flights.map((c) => attr(c, "departure_time"))).toEqual(["09:30", "14:10", "23:40"]);
    expect(attr(flights[0]!, "arrival_time")).toBe("11:00");
    expect(attr(flights[0]!, "airline")).toBe("Azerbaijan Airlines");
    expect(attr(flights[2]!, "stops_label")).toBe("1 stop");
    expect(attr(flights[2]!, "arrival_day_offset")).toBe(1); // 23:40 + 6h40 -> next day
    expect(flights[0]!.price).toEqual({ from: 120, currency: "USD" });
    expect(flights[0]!.action.event.value).toMatch(
      /^https:\/\/www\.aviasales\.com\/search\/GYD2003IST1/,
    );
    expect(flights[0]!.subtitle).toContain("check price on site");
    expect(r.ui!.cards.find((c) => c.kind === "hotel")!.price).toEqual({
      from: 85,
      currency: "AZN",
    });
    expect(r.ui!.cards.some((c) => c.id === "f_search")).toBe(false); // link card only when no options

    // Turn 5: cinema tonight -> topic switch; movies picked by ref from the real CineMastercard parser.
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "cinema",
        topic_change: true,
        slots: { date: "tonight", cinema: "Deniz Mall" },
        task: `List movies tonight (${TODAY}) at Deniz Mall.`,
        topic_summary: "Cinema tonight.",
      }),
    );
    queue.module_agent.push(tool("cinema_sessions", { date: TODAY, cinemas: ["Deniz Mall"] }));
    queue.module_agent.push(
      fromTools((res) => ({
        status: "ok",
        summary: "Movies tonight.",
        items: (res[0] as { movies: { ref: string }[] }).movies.map((m) => ({ ref: m.ref })),
      })),
    );
    queue.responder.push(
      json({
        text: "Two films tonight at Deniz Mall.",
        cards: [{ id: "m_street-fighter" }],
        quick_replies: [{ label: "Back to trip", event: { type: "switch_topic", value: "t1" } }],
      }),
    );
    r = await handleTurn({ state: r.state, message: "What's on at Deniz Mall tonight?" });
    s = (await decodeState(r.state))!;
    expect(s.active_topic_id).toBe("t2");
    expect(s.topics[0]!.status).toBe("parked");
    expect(s.topics[0]!.slots["destination"]).toBe("Istanbul");
    const movie = r.ui!.cards[0]!;
    expect(movie.title).toBe("Street Fighter");
    expect((attr(movie, "showtimes") as { time: string }[]).map((x) => x.time)).toEqual([
      "23:10",
      "23:50",
    ]);
    expect(movie.price).toEqual({ from: 6, currency: "AZN" });
    expect(movie.action.event.value).toBe("https://cinemastercard.az/en/films/street-fighter/");

    // Turn 6: "How much was that Istanbul hotel?" -> answer_from_context, resume t1, NO module call.
    // The first Responder answer invents a number -> retried once.
    const moduleCalls = calls.filter((c) => c.role === "module_agent").length;
    queue.orchestrator.push(
      json({
        ...D,
        decision: "answer_from_context",
        module: "travel_planner",
        topic_change: true,
        resume_topic_id: "t1",
        topic_summary: "Picked Istanbul; asked hotel price.",
      }),
    );
    queue.responder.push(json({ text: "Hotel Sultan was 79 AZN.", quick_replies: [] }));
    queue.responder.push(
      json({
        text: "Hotel Sultan was from 85 AZN per night.",
        cards: [{ id: "h1" }],
        quick_replies: [{ label: "Back to movies", event: { type: "switch_topic", value: "t2" } }],
      }),
    );
    r = await handleTurn({ state: r.state, message: "How much was that Istanbul hotel?" });
    s = (await decodeState(r.state))!;
    expect(r.meta.decision).toBe("answer_from_context");
    expect(s.active_topic_id).toBe("t1");
    expect(calls.filter((c) => c.role === "module_agent").length).toBe(moduleCalls);
    expect(r.ui!.text).toContain("85");
    expect(r.ui!.cards[0]!.price).toEqual({ from: 85, currency: "AZN" });

    // Turn 7: suitcase -> shopping agent (search_products; catalog down -> Birmarket pages); travel stays parked.
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "shopping_assistant",
        topic_change: true,
        slots: { query: "çamadan" },
        task: "Find suitcases.",
        topic_summary: "Needs a suitcase.",
      }),
    );
    queue.module_agent.push(
      tool("search_products", { query: "çamadan" }),
      fromTools(([res]) => ({
        status: "ok",
        summary: "Suitcases on Birmarket.",
        items: (res!["products"] as { ref: string }[]).map((p) => ({ ref: p.ref })),
      })),
    );
    queue.responder.push(
      json({ text: "Here are suitcases on Birmarket.", cards: [{ id: "p101" }] }),
    );
    r = await handleTurn({ state: r.state, message: "I also need a suitcase" });
    s = (await decodeState(r.state))!;
    expect(r.meta.module).toBe("shopping_assistant");
    expect(r.ui!.cards[0]!.price).toEqual({ from: 189, currency: "AZN" });
    expect(r.ui!.cards[0]!.action.event.value).toBe("https://birmarket.az/product/101-camadan");
    expect(s.topics.find((x) => x.id === "t1")!.status).toBe("parked");
    expect(calls.filter((c) => c.role === "module_agent").length).toBe(moduleCalls + 2);
    // The shopping agent sees the user's own words (colour / size the task may leave out).
    expect(calls.at(-2)!.system).toContain("I also need a suitcase");
    expect(r.ui!.quick_replies.length).toBeGreaterThanOrEqual(2);
  });

  it("foreign passport: asks for the departure city, then flights from all its airports; 'earlier' filters", async () => {
    calls.length = 0;
    // Turn 1: Italian passport -> origin is NOT assumed to be Baku -> ask for city/airport.
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        topic_change: true,
        slots: { destination_or_criteria: "Istanbul", transport: "Flight" },
        task: "Find flights to Istanbul.",
        topic_summary: "Flights to Istanbul.",
        profile_updates: { citizenship: "IT" },
      }),
    );
    queue.responder.push(
      json({
        text: "From which city and airport will you depart?",
        quick_replies: [
          { label: "Rome", event: { type: "select", slot: "origin", value: "Rome" } },
          { label: "Milan", event: { type: "select", slot: "origin", value: "Milan" } },
        ],
      }),
    );
    let r = await handleTurn({
      message: "I have an Italian passport, find me flights to Istanbul",
      user,
    });
    expect(r.meta.decision).toBe("clarify");
    expect(calls.filter((c) => c.role === "module_agent").length).toBe(0);
    let s = (await decodeState(r.state))!;
    expect(s.user.citizenship).toBe("IT");
    expect(s.user.home_city_confirmed).toBe(false);
    expect(r.ui!.quick_replies.map((q) => q.label)).toEqual(["Rome", "Milan", "Type my own"]);

    // Turn 2: "Milan" (the app sends its default AZ profile again: it must not undo the passport).
    // The departure city is known now; the dates were never given -> asked once, with the calendar.
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        slots: { destination_or_criteria: "Istanbul", transport: "Flight", origin: "Milan" },
        task: "Find flights Milan-Istanbul.",
        topic_summary: "Flights Milan to Istanbul.",
      }),
    );
    queue.responder.push(json({ text: "When do you want to fly?", quick_replies: [] }));
    r = await handleTurn({ state: r.state, message: "Milan", user });
    expect(r.meta.decision).toBe("clarify");
    expect(calls.filter((c) => c.role === "module_agent").length).toBe(0);
    expect(r.ui!.quick_replies[0]!.event).toEqual({ type: "date_picker", slot: "dates" });
    expect(r.ui!.quick_replies.at(-1)!.event.type).toBe("free_text");
    s = (await decodeState(r.state))!;
    expect(s.user.citizenship).toBe("IT");

    // Turn 2b: "any dates, I'm flexible" -> cheapest dates; several airports in the city.
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        slots: { destination_or_criteria: "Istanbul", transport: "Flight", origin: "Milan" },
        task: "Find flights Milan-Istanbul, flexible dates.",
        topic_summary: "Flights Milan to Istanbul, flexible dates.",
      }),
    );
    queue.module_agent.push(
      tool("search_flights", { origin: "Milan", destination: "Istanbul", depart: "", adults: 1 }),
    );
    queue.module_agent.push(
      fromTools((res) => ({
        status: "ok",
        summary: "Flights.",
        items: (res[0] as { options: { ref: string }[] }).options.map((o) => ({ ref: o.ref })),
      })),
    );
    queue.responder.push(json({ text: "Here are the cheapest flights from Milan.", cards: [] }));
    r = await handleTurn({ state: r.state, message: "any dates, I'm flexible", user });
    s = (await decodeState(r.state))!;
    expect(fetched.some((u) => u.includes("prices_for_dates") && u.includes("origin=MIL"))).toBe(
      true,
    );
    const cards = r.ui!.cards;
    expect(cards.map((c) => attr(c, "from_airport"))).toEqual(["MXP", "BGY", "MXP"]);
    // 07:05 +01 = 06:05 UTC, + 175 min = 09:00 UTC = 12:00 Istanbul (+03)
    expect(attr(cards[0]!, "arrival_time")).toBe("12:00");
    // The user said "flexible": that is their answer, not a guess -> no follow-up question about dates.
    expect(s.topics[0]!.slots["dates"]).toMatch(/^flexible/);
    expect(s.topics[0]!.assumed!["dates"]).toBeUndefined();
    // Several airports in the city -> code adds "From MXP / LIN / BGY" chips to the module result.
    const stored = s.results[s.topics[0]!.last_result_ref!]!;
    expect(stored.suggestions.map((x) => x.label)).toContain("From MXP");

    // Turn 3: "anything earlier?" -> the agent sees previous departure times and filters with depart_before.
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        slots: { constraints: "earlier than shown" },
        task: "Show flights departing earlier than 13:20.",
        topic_summary: "Wants earlier flights.",
      }),
    );
    queue.module_agent.push((msgs) => {
      expect(String(msgs[0]!.content)).toContain('"departure_time":"07:05"'); // previous_results
      return tools([
        "search_flights",
        { origin: "Milan", destination: "Istanbul", depart: "", depart_before: "13:00" },
      ])(msgs);
    });
    queue.module_agent.push(
      fromTools((res) => ({
        status: "ok",
        summary: "Earlier flights.",
        items: (res[0] as { options: { ref: string }[] }).options.map((o) => ({ ref: o.ref })),
      })),
    );
    queue.responder.push(json({ text: "This is the earliest option.", cards: [] }));
    r = await handleTurn({ state: r.state, message: "anything earlier?", user });
    expect(r.ui!.cards.map((c) => attr(c, "departure_time"))).toEqual(["07:05"]);
  });

  it("round trip not in the cache (FCO-IST Dec 3-5): round-trip cards built from two one-way tickets", async () => {
    const { searchFlightOptions } = await import("@/lib/assistant/tools/flights");
    const r = await searchFlightOptions({
      origin: "FCO",
      destination: "Istanbul",
      depart: "2026-12-03",
      return: "2026-12-05",
      adults: 2,
    });
    expect(r.split_legs).toBe(false);
    expect(r.combined_legs).toBe(true);
    // Every card is a round trip: outbound FCO -> IST/SAW on Dec 3 + return on the nearest cached day (Dec 6).
    expect(r.items.length).toBe(2);
    expect(r.items.every((i) => i.attributes["trip"] === "round")).toBe(true);
    expect(r.items.every((i) => i.attributes["from_airport"] === "FCO")).toBe(true); // Ciampino left out
    expect(r.items.map((i) => i.attributes["return_date"])).toEqual(["2026-12-06", "2026-12-06"]);
    // Cheapest first; price = outbound + return per person, x 2 passengers on the card.
    expect(r.items[0]!.attributes["departure_time"]).toBe("13:10");
    expect(r.items[0]!.attributes["arrival_time"]).toBe("17:55"); // 13:10 +01 + 2h45 -> 17:55 Istanbul
    expect(r.items[0]!.attributes["price_per_person"]).toBe(61 + 83);
    expect(r.items[0]!.price).toEqual({ amount: (61 + 83) * 2, currency: "USD" });
    expect(r.items[1]!.attributes["price_per_person"]).toBe(98 + 83);
    expect(r.items[0]!.attributes["tags"]).toEqual(["Cheapest", "Nearby date"]);
    // The booking link is the Aviasales round-trip search for the asked dates and passengers.
    expect(r.items[0]!.action.value).toMatch(/\/search\/FCO0312IST05122/);
    expect(r.nearby_dates).toBe(true);
    // Tried first: the exact round trip, then round trips on nearby dates of the same month.
    expect(
      fetched.some((u) => u.includes("prices_for_dates") && u.includes("return_at=2026-12-05")),
    ).toBe(true);
    expect(
      fetched.some(
        (u) =>
          u.includes("prices_for_dates") && u.includes("departure_at=2026-12&return_at=2026-12"),
      ),
    ).toBe(true);
  });

  it("Azerbaijani round trip: 'bakidan londona ... 3 noyabr gedirem 11 noyabr gayidiram' -> round-trip cards", async () => {
    calls.length = 0;
    // The model keeps the dates as free text and forgets the return date in the tool call: code fixes both.
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        topic_change: true,
        slots: { destination_or_criteria: "London", dates: "3 noyabr gedirem 11 noyabr gayidiram" },
        task: "Find flights Baku-London.",
        topic_summary: "Baku to London.",
        reply_language: "az",
      }),
    );
    queue.module_agent.push(
      tool("search_flights", { origin: "Baku", destination: "London", depart: LON_DEP }),
    );
    queue.module_agent.push(
      fromTools((res) => ({
        status: "ok",
        summary: "Round trips.",
        items: (res[0] as { options: { ref: string }[] }).options.map((o) => ({ ref: o.ref })),
      })),
    );
    queue.responder.push(json({ text: "Bakı - London gediş-dönüş variantları.", cards: [] }));
    const r = await handleTurn({
      message:
        "mene bakidan londona 2 nefer ucun bilet lazimdi 3 noyabr gedirem 11 noyabr gayidiram",
      user: { ...user, language: "az" },
    });
    expect(r.meta.decision).toBe("route");
    const s = (await decodeState(r.state))!;
    expect(s.topics[0]!.slots).toMatchObject({
      origin: "Baku",
      destination_or_criteria: "London",
      dates: `${LON_DEP}/${LON_RET}`,
      travelers: "2",
    });
    expect(
      fetched.some(
        (u) =>
          u.includes("prices_for_dates") &&
          u.includes("origin=GYD") &&
          u.includes("destination=LON") &&
          u.includes("one_way=false") &&
          u.includes(`return_at=${LON_RET}`),
      ),
    ).toBe(true);
    const cards = r.ui!.cards;
    // Several options, all round trips with their return flight; the far-away fare (Nov 20) is not shown.
    expect(cards.length).toBe(3);
    expect(cards.every((c) => attr(c, "trip") === "round" && !!attr(c, "return_date"))).toBe(true);
    expect(cards.map((c) => attr(c, "departure_date"))).toEqual([LON_DEP, LON_DEP, `${YN}-11-04`]);
    const tk = cards.find((c) => attr(c, "flight_number") === "TK 333")!;
    expect(tk.price).toEqual({ from: 820, currency: "USD" }); // 410 round-trip fare x 2 passengers
    expect(attr(tk, "price_per_person")).toBe(410);
    expect(attr(tk, "price_note")).toBe("for the round trip (both ways)");
    expect(attr(tk, "return_departure_time")).toBe("11:40");
    expect(attr(tk, "return_from_airport")).toBe("LHR");
    expect(attr(tk, "return_to_airport")).toBe("GYD");
    expect(tk.action.event.value).toContain(`/search/GYD${ddmmOf(LON_DEP)}LON${ddmmOf(LON_RET)}2`);
    const pc = cards.find(
      (c) => attr(c, "airline") === "Pegasus" || attr(c, "flight_number") === "PC 91",
    )!;
    expect(attr(pc, "tags")).toContain("Nearby date");
  });

  it("'i want different date' after round-trip results opens the calendar (not just text chips)", async () => {
    calls.length = 0;
    // Turn 1: a round trip is shown (same data as the Azerbaijani test).
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        topic_change: true,
        slots: { destination_or_criteria: "London" },
        task: "Find flights Baku-London.",
      }),
    );
    queue.module_agent.push(
      tool("search_flights", { origin: "Baku", destination: "London", depart: LON_DEP }),
    );
    queue.module_agent.push(
      fromTools((res) => ({
        status: "ok",
        summary: "Round trips.",
        items: (res[0] as { options: { ref: string }[] }).options.map((o) => ({ ref: o.ref })),
      })),
    );
    queue.responder.push(json({ text: "Round trips.", cards: [] }));
    let r = await handleTurn({
      message: "bakidan londona 3 noyabr gedirem 11 noyabr gayidiram",
      user,
    });
    expect(r.ui!.cards.length).toBe(3);
    // Turn 2: the model treats it as a question about the shown results and offers its own date chips.
    queue.orchestrator.push(
      json({ ...D, decision: "answer_from_context", module: "travel_planner", task: "New dates." }),
    );
    queue.responder.push(
      json({
        text: "Pick new dates.",
        quick_replies: [
          {
            label: "13-15 Nov",
            event: { type: "select", slot: "dates", value: `${YN}-11-13/${YN}-11-15` },
          },
        ],
      }),
    );
    const agentCalls = calls.filter((c) => c.role === "module_agent").length;
    r = await handleTurn({ state: r.state, message: "i want different date", user });
    expect(r.meta.decision).toBe("clarify");
    expect(calls.filter((c) => c.role === "module_agent").length).toBe(agentCalls); // no search yet
    const picker = r.ui!.quick_replies.find((q) => q.event.type === "date_picker")!;
    expect(picker.event.value).toContain(`m=${YN}-11`);
    expect(picker.event.value).toContain("mode=round");
    const s = (await decodeState(r.state))!;
    expect(s.topics[0]!.slots["dates"]).toBeUndefined();
    expect(s.topics[0]!.slots["destination_or_criteria"]).toBe("London");
  });

  it("'Cheapest' is the cheapest card actually shown, whatever group or search call it came from", async () => {
    const { tagFlights } = await import("@/lib/assistant/agents/module_agent");
    const f = (id: string, per: number, dur: string, ret: string, tags: string[]) => ({
      id,
      kind: "flight",
      title: id,
      subtitle: "",
      attributes: {
        departure_time: "10:00",
        duration: dur,
        return_duration: ret,
        price_per_person: per,
        tags,
      },
      price: { amount: per, currency: "USD" },
      source_url: "https://www.aviasales.com/",
      verify: true,
      action: { label: "Book", type: "handoff_url" as const, value: "https://www.aviasales.com/" },
    });
    // As in the screenshot: $342 untagged (round-trip group), $472 tagged Cheapest (another group).
    const items = [
      f("a", 342, "7h 05m", "7h 40m", []),
      f("b", 748, "7h 20m", "5h 30m", ["Fastest"]),
      f("c", 472, "7h 25m", "6h 35m", ["Cheapest", "Nearby date"]),
    ];
    tagFlights(items);
    expect(items[0]!.attributes["tags"]).toEqual(["Cheapest"]);
    expect(items[1]!.attributes["tags"]).toEqual(["Fastest"]); // 12h 50m in total, the shortest
    expect(items[2]!.attributes["tags"]).toEqual(["Nearby date"]);
  });

  it("the user's exact dates come first: Nov 12 -> 15 shows those days, nearby dates only after them", async () => {
    const { searchFlightOptions } = await import("@/lib/assistant/tools/flights");
    const r = await searchFlightOptions({
      origin: "Baku",
      destination: "London",
      depart: `${YN}-11-12`,
      return: `${YN}-11-15`,
      adults: 1,
    });
    const first = r.items[0]!;
    expect(first.attributes["departure_date"]).toBe(`${YN}-11-12`);
    expect(first.attributes["return_date"]).toBe(`${YN}-11-15`);
    expect(first.attributes["nearby_date"]).toBeUndefined();
    expect(first.attributes["price_per_person"]).toBe(190 + 170); // two one-way tickets on the exact days
    // Nearby round-trip fares (Nov 10-17, Nov 12-14) may follow, never before the exact days.
    const after = r.items.slice(1);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((i) => i.attributes["nearby_date"] === true)).toBe(true);
  });

  it("only nearby dates found: the first card opens the live Aviasales search for the exact dates", async () => {
    const ctx = newToolContext();
    const link = {
      id: "f_search",
      kind: "flight",
      title: "Your exact dates on Aviasales (live prices)",
      subtitle: "GYD → LON",
      attributes: {},
      price: { amount: null, currency: null },
      source_url: "https://www.aviasales.com/search/GYD1211LON15111",
      verify: false,
      action: {
        label: "Open Aviasales",
        type: "handoff_url" as const,
        value: "https://www.aviasales.com/search/GYD1211LON15111",
      },
    };
    const near = {
      ...link,
      id: "f_near",
      title: "near",
      attributes: { departure_time: "05:50", nearby_date: true },
    };
    ctx.items.set("f_search", link);
    mark(ctx, link.source_url, "fetched");
    const g = groundResult(
      {
        status: "ok",
        summary: "",
        items: [near],
        suggestions: [],
        need_input: null,
        refinements: [],
      },
      ctx,
    );
    expect(g.result.items.map((i) => i.id)).toEqual(["f_search", "f_near"]);
  });

  it("a new destination ('now I want to go to Dubai') asks the dates again with the calendar", async () => {
    calls.length = 0;
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        topic_change: true,
        slots: { destination_or_criteria: "London" },
        task: "Find flights Baku-London.",
      }),
    );
    queue.module_agent.push(tool("search_flights", { origin: "Baku", destination: "London" }));
    queue.module_agent.push(
      fromTools((res) => ({
        status: "ok",
        summary: "Round trips.",
        items: (res[0] as { options: { ref: string }[] }).options.map((o) => ({ ref: o.ref })),
      })),
    );
    queue.responder.push(json({ text: "Round trips.", cards: [] }));
    let r = await handleTurn({
      message: "bakidan londona 3 noyabr gedirem 11 noyabr gayidiram",
      user,
    });
    expect(r.ui!.cards.length).toBeGreaterThan(0);
    // The model keeps the old dates for the new city.
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        slots: { destination_or_criteria: "Dubai", dates: `${LON_DEP}/${LON_RET}` },
        task: "Find flights Baku-Dubai.",
      }),
    );
    queue.responder.push(json({ text: "When do you want to go to Dubai?", quick_replies: [] }));
    const agentCalls = calls.filter((c) => c.role === "module_agent").length;
    r = await handleTurn({ state: r.state, message: "now i want to go to dubai", user });
    expect(r.meta.decision).toBe("clarify");
    expect(calls.filter((c) => c.role === "module_agent").length).toBe(agentCalls);
    const picker = r.ui!.quick_replies.find((q) => q.event.type === "date_picker")!;
    expect(picker.event.value).toContain("mode=round");
    expect(picker.event.value).toContain(`m=${YN}-11`);
    const st = (await decodeState(r.state))!;
    expect(st.topics.at(-1)!.slots["destination_or_criteria"]).toBe("Dubai");
    expect(st.topics.at(-1)!.slots["dates"]).toBeUndefined();
  });

  it("direction is never swapped: 'Şanxaydan Bakıya' searches Shanghai -> Baku even if the model swaps it", async () => {
    calls.length = 0;
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        topic_change: true,
        // Model mistake: the home city as origin.
        slots: { origin: "Baku", destination_or_criteria: "Shanghai", dates: "10 dekabr" },
        task: "Find flights Baku-Shanghai.",
        topic_summary: "Flights.",
        reply_language: "az",
      }),
    );
    queue.module_agent.push(
      tool("search_flights", { origin: "Baku", destination: "Shanghai", depart: SHA_DEP }),
    );
    queue.module_agent.push(
      fromTools((res) => ({
        status: "ok",
        summary: "Flights.",
        items: (res[0] as { options: { ref: string }[] }).options.map((o) => ({ ref: o.ref })),
      })),
    );
    queue.responder.push(json({ text: "Şanxay - Bakı uçuşları.", cards: [] }));
    const r = await handleTurn({
      message: "Şanxaydan Bakıya bilet tap 10 dekabr, birtərəfli",
      user: { ...user, language: "az" },
    });
    const cards = r.ui!.cards;
    expect(cards.length).toBe(1);
    expect(attr(cards[0]!, "from_airport")).toBe("PVG");
    expect(attr(cards[0]!, "to_airport")).toBe("GYD");
    expect(
      fetched.some(
        (u) =>
          u.includes("prices_for_dates") &&
          u.includes("origin=GYD") &&
          u.includes("destination=SHA"),
      ),
    ).toBe(false);
    const s = (await decodeState(r.state))!;
    expect(s.topics[0]!.slots).toMatchObject({
      origin: "Shanghai",
      destination_or_criteria: "Baku",
      dates: SHA_DEP,
    });
  });

  it("destination without dates: asks for the dates with the calendar before searching", async () => {
    calls.length = 0;
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "travel_planner",
        topic_change: true,
        slots: { destination_or_criteria: "London" },
        task: "Find flights to London.",
        reply_language: "az",
      }),
    );
    queue.responder.push(json({ text: "Nə vaxt getmək istəyirsiniz?", quick_replies: [] }));
    const r = await handleTurn({ message: "Londona getmek isteyirem", user });
    expect(r.meta.decision).toBe("clarify");
    expect(calls.some((c) => c.role === "module_agent")).toBe(false);
    expect(r.ui!.quick_replies.some((q) => q.event.type === "date_picker")).toBe(true);
  });

  it("budget is enforced in code: items above it are removed", async () => {
    await import("@/lib/assistant/tools/money").then((m) => m.loadRates());
    const ctx = newToolContext();
    mark(ctx, "https://hotels.test/istanbul", "searched");
    const hotel = (id: string, amount: number, currency: string) => ({
      id,
      kind: "hotel",
      title: id,
      subtitle: "",
      attributes: { price_basis: "per night" },
      price: { amount, currency },
      source_url: "https://hotels.test/istanbul",
      verify: true,
      action: {
        label: "Book",
        type: "handoff_url" as const,
        value: "https://hotels.test/istanbul",
      },
    });
    const g = groundResult(
      {
        status: "ok",
        summary: "",
        items: [hotel("cheap", 85, "AZN"), hotel("pricey", 400, "AZN"), hotel("usd", 50, "USD")],
        suggestions: [],
        need_input: null,
        refinements: [],
      },
      ctx,
      { budget: "under 100 AZN per night", maxItems: 8 },
    );
    expect(g.result.items.map((i) => i.id)).toEqual(["cheap", "usd"]); // 50 USD = 85 AZN
    expect(parseBudget("до 1 500 манат")).toEqual({ max: 1500, currency: "AZN", basis: "any" });
    expect(parseBudget("$80 per night")).toEqual({ max: 80, currency: "USD", basis: "per_night" });
  });

  it("Birmarket: iPhones are found via the live tag page; non-breaking-space prices parse; cases rank below phones", async () => {
    const parsed = parseBirmarketHtml(IPHONE_TAG_HTML);
    expect(parsed.find((p) => p.id === "958296")).toMatchObject({
      price_azn: 1784.04,
      old_price: 2299,
    });
    expect(parsed.find((p) => p.id === "945267")!.price_azn).toBe(1499);
    const res = await DIRECT_ADAPTERS["birmarket_v1"]!({
      query: "smartfon apple iphone",
      slots: { budget_max: "1600" },
      session: null as never,
      language: "en",
    });
    expect(fetched).toContain("https://birmarket.az/tags/iphone");
    expect(res.items.map((i) => i.title)).toEqual([
      "Smartfon Apple iPhone 15 Dual Sim 128GB Black",
    ]);
    const all = await DIRECT_ADAPTERS["birmarket_v1"]!({
      query: "smartfon apple iphone 16",
      slots: {},
      session: null as never,
      language: "en",
    });
    expect(all.items[0]!.title).toBe("Smartfon Apple iPhone 16 8GB/128GB White");
    expect(all.items.some((i) => i.title.startsWith("Çexol"))).toBe(false);
    expect(all.items.some((i) => i.title.includes("Samsung"))).toBe(false);
  });

  it("gift with no product named ('something for my mom'): real product suggestions", async () => {
    const giftFor = (query: string, slots: Record<string, string> = {}) =>
      DIRECT_ADAPTERS["birmarket_v1"]!({ query, slots, session: null as never, language: "en" });
    const r = await giftFor("hədiyyə", { gift_for: "mom" });
    expect(r.status).toBe("ok");
    expect(r.items.map((i) => i.title)).toEqual([
      "Ətir Lancome La Vie Est Belle EDP 50 ml",
      "Qol saatı Casio Sheen",
      "Kofe maşını DeLonghi Dedica",
      "Fen Dyson Supersonic",
      "Sırğa gümüş 925",
    ]);
    expect(r.suggestions.map((x) => x.label)).toEqual([
      "Perfume & beauty",
      "Watches & jewelry",
      "Home appliances",
    ]);
    expect(
      (await giftFor("i wanna buy smth for my mom", { budget_max: "200" })).items.map(
        (i) => i.price.amount,
      ),
    ).toEqual([189, 79]);
    for (const q of [
      "anama bir şey almaq istəyirəm",
      "хочу купить что-то для мамы",
      "something for my mom",
    ])
      expect((await giftFor(q)).summary).toMatch(/Gift ideas/);
    expect((await giftFor("smartfon apple iphone 16")).summary).not.toMatch(/Gift ideas/);
    // A named product keeps the normal search.
    expect((await giftFor("ətir", { gift_for: "mom" })).summary).not.toMatch(/Gift ideas/);
  });

  it("cinema list: malls / cinemas come back as selectable cards", async () => {
    const ctx = newToolContext();
    const out = (await AGENT_ADAPTERS["cinemaplus_list_v1"]!(
      { city: "Baku" },
      { name: "cinema_list", description: "", input_schema: {}, adapter: "cinemaplus_list_v1" },
      ctx,
    )) as { cinemas: { ref: string; name: string }[] };
    expect(out.cinemas.map((c) => c.name)).toContain("28 Mall");
    expect(out.cinemas.every((c) => ctx.items.get(c.ref)!.action.type === "select")).toBe(true);
    expect(out.cinemas.some((c) => c.name === "Ganja Mall")).toBe(false);
  });

  it("tampered state token is rejected (a new session starts)", async () => {
    queue.orchestrator.push(
      json({
        ...D,
        decision: "clarify",
        module: "shopping_assistant",
        topic_change: true,
        missing_slot: { name: "query" },
      }),
    );
    queue.responder.push(json({ text: "What are you looking for?" }));
    const r = await handleTurn({ message: "shop", user });
    const [payload, sig] = r.state.split(".");
    const forged = JSON.parse(Buffer.from(payload!, "base64url").toString());
    forged.user.citizenship = "XX";
    const bad = Buffer.from(JSON.stringify(forged)).toString("base64url") + "." + sig;
    expect(await decodeState(bad)).toBeNull();
    expect((await decodeState(r.state))!.user.citizenship).toBe("AZ");
  });

  it("model output invalid twice -> safe fallback with options", async () => {
    queue.orchestrator.push(json({ decision: "dance" }), json({ nope: true }));
    const r = await handleTurn({ message: "asdf", user: { language: "az" } });
    expect(r.ui!.text.length).toBeGreaterThan(0);
    expect(r.ui!.quick_replies.at(-1)!.event.type).toBe("free_text");
  });

  it("a missing required slot without fallback becomes a question with registry options", async () => {
    queue.orchestrator.push(
      json({
        ...D,
        decision: "route",
        module: "shopping_assistant",
        topic_change: true,
        slots: {},
        task: "Shop.",
      }),
    );
    queue.responder.push(json({ text: "What are you looking for?" }));
    const r = await handleTurn({ message: "shopping", user });
    expect(r.meta.decision).toBe("clarify");
    expect(r.ui!.quick_replies.map((q) => q.event.value ?? q.event.type)).toEqual([
      "Smartphone",
      "Headphones",
      "Gift ideas",
      "free_text",
    ]);
  });

  it("cinema without a date shows today's films instead of asking first", async () => {
    queue.orchestrator.push(
      json({
        ...D,
        decision: "clarify",
        module: "cinema",
        topic_change: true,
        missing_slot: { name: "date" },
      }),
    );
    queue.module_agent.push(tool("cinema_sessions", { date: TODAY, cinemas: ["Deniz Mall"] }));
    queue.module_agent.push(
      fromTools((res) => ({
        status: "ok",
        summary: "",
        items: (res[0] as { movies: { ref: string }[] }).movies.map((m) => ({ ref: m.ref })),
      })),
    );
    queue.responder.push(json({ text: "Films tonight. Or another day?", cards: [] }));
    const r = await handleTurn({ message: "kino", user });
    expect(r.meta.decision).toBe("route");
    expect(r.ui!.cards.length).toBeGreaterThan(0);
  });

  it("cinema dates other than today/tomorrow are refused by the tool, not invented", async () => {
    const out = (await AGENT_ADAPTERS["cinemaplus_v1"]!(
      { date: "2030-01-01" },
      { name: "cinema_sessions", description: "", input_schema: {}, adapter: "cinemaplus_v1" },
      newToolContext(),
    )) as { error?: string };
    expect(out.error).toMatch(/Only today/);
  });

  it("a 4th module plugs in with only a registry change", () => {
    const before = loadRegistry(REGISTRY_YAML);
    const after = loadRegistry(
      REGISTRY_YAML.replace(
        "display_name: Weather\n  enabled: false",
        "display_name: Weather\n  enabled: true",
      ),
    );
    expect(after.length).toBe(before.length + 1);
    expect(moduleCards(after)).toContain("id: weather");
  });

  it("reasoning effort: an unsupported value falls back to the next one instead of being dropped", async () => {
    const bodies: Record<string, unknown>[] = [];
    const prev = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.reasoning_effort === "none")
        return new Response(
          "Unsupported value: 'reasoning_effort' does not support 'none' with this model.",
          { status: 400 },
        );
      if (body.temperature !== undefined)
        return new Response("Unsupported parameter: 'temperature'", { status: 400 });
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    }) as typeof fetch;
    try {
      await _azureChat("orchestrator", [{ role: "user", content: "hi" }], { json: true });
      await _azureChat("orchestrator", [{ role: "user", content: "hi" }], { json: true });
    } finally {
      globalThis.fetch = prev;
    }
    expect(bodies.at(-1)!["reasoning_effort"]).toBe("minimal");
    // Remembered: the second call goes straight to the accepted value.
    expect(bodies.filter((b) => b["reasoning_effort"] === "none").length).toBe(1);
  });
});
