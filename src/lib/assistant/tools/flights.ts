// Flights: Travelpayouts (Aviasales) Data API, turned into ready-to-show flight items in code.
// - Any city or airport name (any language) or IATA code is resolved with the Aviasales autocomplete API.
// - Departure AND arrival local times (arrival in the destination airport's time zone), duration, stops.
// - Direct and transit options are both fetched; filters for earlier/later, direct only, max price.
// All values on an item come from the API response; nothing is written by the model.
import { CITIES, lower } from "@/lib/bir";
import { CONFIG } from "../config";
import type { Item } from "../core/schemas";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

// ---------- small TTL cache ----------
const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v as T;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  return v;
}
const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

// ---------- reference data (airports with time zones, airline names) ----------
type Airport = { code: string; name: string; city_code: string; country_code: string; tz: string };
let airportsP: Promise<Map<string, Airport>> | null = null;
let airlinesP: Promise<Map<string, string>> | null = null;

function airports(): Promise<Map<string, Airport>> {
  airportsP ??= (async () => {
    const res = await fetch("https://api.travelpayouts.com/data/en/airports.json", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`airports.json ${res.status}`);
    const rows = (await res.json()) as Record<string, unknown>[];
    const m = new Map<string, Airport>();
    for (const r of rows) {
      const code = String(r["code"] ?? "");
      if (!/^[A-Z]{3}$/.test(code)) continue;
      if (r["iata_type"] && r["iata_type"] !== "airport") continue;
      m.set(code, {
        code,
        name: String(r["name"] ?? code),
        city_code: String(r["city_code"] ?? code),
        country_code: String(r["country_code"] ?? ""),
        tz: String(r["time_zone"] ?? ""),
      });
    }
    return m;
  })().catch((e) => {
    airportsP = null; // try again next time
    throw e;
  });
  return airportsP;
}
function airlines(): Promise<Map<string, string>> {
  airlinesP ??= (async () => {
    const res = await fetch("https://api.travelpayouts.com/data/en/airlines.json", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`airlines.json ${res.status}`);
    const rows = (await res.json()) as Record<string, unknown>[];
    const m = new Map<string, string>();
    for (const r of rows) {
      const code = String(r["code"] ?? "");
      const tr = r["name_translations"] as Record<string, string> | undefined;
      const name = String(r["name"] ?? tr?.["en"] ?? "");
      if (code && name) m.set(code, name);
    }
    return m;
  })().catch((e) => {
    airlinesP = null;
    throw e;
  });
  return airlinesP;
}

// ---------- place resolution ----------
export type Place = {
  code: string;
  type: "city" | "airport";
  name: string;
  city_code: string;
  city_name: string;
  country_code: string;
};

async function autocomplete(term: string): Promise<Place[]> {
  return cached(`ac:${lower(term)}`, 24 * 3600_000, async () => {
    const url =
      "https://autocomplete.travelpayouts.com/places2?locale=en&types[]=city&types[]=airport&term=" +
      encodeURIComponent(term);
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`autocomplete ${res.status}`);
    const rows = (await res.json()) as Record<string, unknown>[];
    return rows
      .filter((r) => r["type"] === "city" || r["type"] === "airport")
      .map((r) => ({
        code: String(r["code"] ?? ""),
        type: r["type"] as "city" | "airport",
        name: String(r["name"] ?? ""),
        city_code: String(r["city_code"] ?? r["code"] ?? ""),
        city_name: String(r["city_name"] ?? r["name"] ?? ""),
        country_code: String(r["country_code"] ?? ""),
      }))
      .filter((p) => /^[A-Z]{3}$/.test(p.code));
  });
}

/** City or airport name in any language, or an IATA code -> Place. null when unknown. */
export async function resolvePlace(raw: string): Promise<Place | null> {
  const v = raw.trim().replace(/\s*\(([A-Z]{3})\)\s*$/, " $1"); // "Milan Malpensa (MXP)" -> "... MXP"
  if (!v) return null;
  const code = v.match(/\b([A-Z]{3})\b/)?.[1];
  const term = code ?? v;
  const found = await withTimeout(autocomplete(term), 6_000, [] as Place[]);
  if (code) {
    const exact = found.find((p) => p.code === code);
    if (exact) return exact;
    const ap = (await withTimeout(airports(), 4_000, new Map<string, Airport>())).get(code);
    if (ap)
      return {
        code,
        type: "airport",
        name: ap.name,
        city_code: ap.city_code,
        city_name: ap.city_code,
        country_code: ap.country_code,
      };
    return { code, type: "city", name: code, city_code: code, city_name: code, country_code: "" };
  }
  if (found[0]) {
    // An airport word in the text ("Malpensa", "airport") -> prefer the airport match.
    const wantsAirport = /airport|aeroport|аэропорт|hava limanı|havalimanı/i.test(v);
    const ap = found.find((p) => p.type === "airport");
    return wantsAirport && ap ? ap : found[0];
  }
  const local = CITIES[lower(v)];
  return local
    ? { code: local, type: "city", name: v, city_code: local, city_name: v, country_code: "" }
    : null;
}

/** Airports with flights in a city (for "which airport?" chips). */
export async function cityAirports(cityCode: string): Promise<{ code: string; name: string }[]> {
  const all = await withTimeout(airports(), 4_000, new Map<string, Airport>());
  return [...all.values()]
    .filter((a) => a.city_code === cityCode)
    .map((a) => ({ code: a.code, name: a.name }));
}

// ---------- time helpers ----------
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMin = (t: string) => {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const durationLabel = (min: number) =>
  min > 0 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : "";

/** "2026-11-14T06:40:00+04:00" -> local date/time exactly as the airline publishes it. */
function localParts(iso: string): { date: string; time: string; offsetMin: number } | null {
  const m = iso.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(Z|([+-])(\d{2}):?(\d{2}))?$/,
  );
  if (!m) return null;
  const offsetMin =
    !m[4] || m[4] === "Z" ? 0 : (m[5] === "-" ? -1 : 1) * (Number(m[6]) * 60 + Number(m[7]));
  return { date: m[1]!, time: `${m[2]}:${m[3]}`, offsetMin };
}
/** Local date/time of an instant in an IANA time zone. */
function inZone(ms: number, tz: string): { date: string; time: string } | null {
  try {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const g = (t: string) => f.find((p) => p.type === t)?.value ?? "";
    return {
      date: `${g("year")}-${g("month")}-${g("day")}`,
      time: `${g("hour").replace("24", "00")}:${g("minute")}`,
    };
  } catch {
    return null;
  }
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// ---------- search ----------
export interface FlightSearch {
  origin: string;
  destination: string;
  depart: string; // YYYY-MM-DD, YYYY-MM or "" (flexible)
  return: string; // YYYY-MM-DD or ""
  adults: number;
  direct_only?: boolean | undefined;
  depart_after?: string | undefined; // HH:MM local
  depart_before?: string | undefined; // HH:MM local
  max_price?: number | null | undefined; // per person, in `currency`
}
type Row = Record<string, unknown>;

function aviasalesPath(o: string, d: string, depart: string, ret: string, adults: number) {
  const ddmm = (iso: string) => (iso.length === 10 ? iso.slice(8, 10) + iso.slice(5, 7) : "");
  return `/search/${o}${ddmm(depart)}${d}${ddmm(ret)}${adults}`;
}
const withMarker = (path: string) => {
  const marker = process.env["TRAVELPAYOUTS_MARKER"] || "";
  return (
    "https://www.aviasales.com" +
    path +
    (marker ? (path.includes("?") ? "&" : "?") + "marker=" + marker : "")
  );
};

async function pricesForDates(p: {
  origin: string;
  destination: string;
  depart: string;
  ret: string;
  direct: boolean;
  market?: string | undefined;
  limit: number;
}): Promise<Row[]> {
  const token = process.env["TRAVELPAYOUTS_TOKEN"];
  if (!token) throw new Error("TRAVELPAYOUTS_TOKEN is not set");
  const params = new URLSearchParams({
    origin: p.origin,
    destination: p.destination,
    one_way: p.ret ? "false" : "true",
    direct: p.direct ? "true" : "false",
    sorting: "price",
    currency: CONFIG.flights.currency,
    limit: String(p.limit),
    token,
  });
  if (p.depart) params.set("departure_at", p.depart);
  if (p.ret) params.set("return_at", p.ret);
  if (p.market) params.set("market", p.market);
  const url = `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params}`;
  return cached(`tp:${url.replace(/token=[^&]+/, "")}`, CONFIG.flights.cacheMs, async () => {
    const body = (await tpGet(url)) as { data?: Row[] };
    return Array.isArray(body.data) ? body.data : [];
  });
}

/**
 * GET a Travelpayouts Data API URL. One search fires many parallel queries (markets x direct/all x
 * legs), so a 429 or 5xx is retried once after a short pause instead of silently becoming "no flights".
 * A `success: false` body is an error too (never cached as an empty result).
 */
async function tpGet(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if ((r.status === 429 || r.status >= 500) && attempt < 1) {
      await new Promise((res) => setTimeout(res, 600 + Math.random() * 400));
      continue;
    }
    if (!r.ok) throw new Error(`Aviasales answered ${r.status}`);
    const body = (await r.json()) as { success?: boolean; error?: unknown };
    if (body && body.success === false)
      throw new Error(`Aviasales error: ${String(body.error ?? "unknown")}`);
    return body;
  }
}

export interface FlightSearchResult {
  origin: Place | null;
  destination: Place | null;
  search_url: string;
  items: Item[];
  /** Short list for the Module Agent: refs + key facts (the full items stay in code). */
  options: Record<string, unknown>[];
  nearby_dates: boolean;
  /** No cached return flight at all: outbound and return are separate one-way options. */
  split_legs?: boolean;
  /** No cached round-trip fare: round-trip options were built from two one-way tickets (price = sum). */
  combined_legs?: boolean;
  filtered_out: number;
  origin_airports: { code: string; name: string }[];
  error?: string;
}

export async function searchFlightOptions(q: FlightSearch): Promise<FlightSearchResult> {
  const [o, d] = await Promise.all([resolvePlace(q.origin), resolvePlace(q.destination)]);
  const adults = Math.max(1, Math.min(9, Math.round(q.adults) || 1));
  const depart = /^\d{4}-\d{2}(-\d{2})?$/.test(q.depart) ? q.depart : "";
  const ret = /^\d{4}-\d{2}-\d{2}$/.test(q.return) ? q.return : "";
  const empty = (error: string, url = withMarker("/")): FlightSearchResult => ({
    origin: o,
    destination: d,
    search_url: url,
    items: [],
    options: [],
    nearby_dates: false,
    filtered_out: 0,
    origin_airports: [],
    error,
  });
  if (!o) return empty(`Unknown origin "${q.origin}". Ask the user for the departure city.`);
  if (!d) return empty(`Unknown destination "${q.destination}".`);
  const searchUrl = withMarker(aviasalesPath(o.code, d.code, depart, ret, adults));

  // Reference data loads in parallel with the price query (never blocks for long).
  const refData = Promise.all([
    withTimeout(airports(), 5_000, new Map<string, Airport>()),
    withTimeout(airlines(), 5_000, new Map<string, string>()),
  ]);

  // The first price query runs while the reference data loads.
  const firstQuery = ret ? legRows(o, d, depart, ret, false) : legRows(o, d, depart, "", true);
  firstQuery.catch(() => {});
  const [aps, als] = await refData;
  const originAirports = o.type === "city" ? await cityAirports(o.code) : [];
  const max = CONFIG.flights.maxOptions;
  let filteredOut = 0;
  // Time-of-day filters apply to the outbound flight; direct-only and budget to every leg.
  const keep = (opts: Opt[], timed: boolean): Opt[] => {
    const after = timed && q.depart_after ? toMin(q.depart_after) : null;
    const before = timed && q.depart_before ? toMin(q.depart_before) : null;
    const kept = opts.filter(
      (x) =>
        (!q.direct_only || (x.stops === 0 && (x.retStops ?? 0) === 0)) &&
        (after == null || x.depMin >= after) &&
        (before == null || x.depMin <= before) &&
        (q.max_price == null || x.price <= q.max_price),
    );
    filteredOut += opts.length - kept.length;
    return kept;
  };
  const build = (L: LegRows) =>
    buildOptions(L, { adults, searchUrl, aps, als, ret: L.leg === "round" });

  const items: Item[] = [];
  let nearby = false,
    splitLegs = false,
    combined = false;
  try {
    if (ret) {
      // Your exact dates always come first; other dates only when nothing exists for them:
      // 1) round-trip fares for the exact dates; 2) fewer than 3 -> round trips built from two one-way
      // tickets on the exact dates; 3) still fewer than 3 -> round-trip fares on nearby dates (each date
      // within 2 days); 4) nothing at all -> one-way tickets on the nearest cached days.
      const add = (more: Item[]) => {
        for (const it of more)
          if (items.length < max && !items.some((x) => x.id === it.id)) items.push(it);
      };
      const exact = await firstQuery;
      if (exact.rows.length)
        add(
          pickVaried(
            keep(build({ rows: exact.rows, from: o, to: d, nearby: false, leg: "round" }), true),
            max,
            "round",
          ),
        );
      const legsOn = async (nearbyDays: boolean) => {
        const [out, back] = await Promise.all([
          legRows(o, d, depart, "", nearbyDays),
          legRows(d, o, ret, "", nearbyDays),
        ]);
        return {
          outK: keep(build({ ...out, leg: "outbound" }), true),
          backK: keep(build({ ...back, leg: "return" }), false),
        };
      };
      if (items.length < 3) {
        const { outK, backK } = await legsOn(false);
        if (outK.length && backK.length) {
          const combos = combineLegs(outK, backK, max - items.length, { adults, searchUrl });
          add(combos);
          combined ||= combos.length > 0;
        }
      }
      if (items.length < 3 && depart.length === 10) {
        const near = await nearbyRoundRows(o, d, depart, ret).catch(() => [] as Row[]);
        const nearOnly = near.filter((r) => r["__nearby"] === true);
        if (nearOnly.length)
          add(
            pickVaried(
              keep(build({ rows: nearOnly, from: o, to: d, nearby: false, leg: "round" }), true),
              max - items.length,
              "round",
            ),
          );
      }
      if (!items.length) {
        const { outK, backK } = await legsOn(true);
        if (outK.length && backK.length) {
          const combos = combineLegs(outK, backK, max, { adults, searchUrl });
          add(combos);
          combined = combos.length > 0;
        } else {
          // No return flight cached at all: show what exists for each direction.
          add([...pickVaried(outK, 4, "outbound"), ...pickVaried(backK, 3, "return")]);
          splitLegs = items.length > 0;
        }
      }
      // Exact-date cards first, nearby dates after them.
      items.sort(
        (a, b) => Number(!!a.attributes["nearby_date"]) - Number(!!b.attributes["nearby_date"]),
      );
    } else {
      const one = await firstQuery;
      items.push(...pickVaried(keep(build({ ...one, leg: "oneway" }), true), max, "oneway"));
    }
  } catch (e) {
    console.error("flights", e);
    return empty(
      "Live prices are unavailable right now; offer the Aviasales search link.",
      searchUrl,
    );
  }
  nearby = items.some((i) => i.attributes["nearby_date"]);

  return {
    origin: o,
    destination: d,
    search_url: searchUrl,
    items,
    options: items.map((it) => ({
      ref: it.id,
      ...(it.attributes["leg"] ? { leg: it.attributes["leg"] } : {}),
      ...(it.attributes["trip"] ? { trip: it.attributes["trip"] } : {}),
      date: it.attributes["departure_date"],
      dep: it.attributes["departure_time"],
      arr: it.attributes["arrival_time"],
      ...(it.attributes["return_date"]
        ? {
            return_date: it.attributes["return_date"],
            return_dep: it.attributes["return_departure_time"],
          }
        : {}),
      stops: it.attributes["stops_label"],
      duration: it.attributes["duration"],
      airline: it.attributes["airline"],
      from: it.attributes["from_airport"],
      to: it.attributes["to_airport"],
      price_per_person: it.attributes["price_per_person"],
      ...(it.attributes["tags"] ? { tags: it.attributes["tags"] } : {}),
    })),
    nearby_dates: nearby,
    split_legs: splitLegs,
    combined_legs: combined,
    filtered_out: filteredOut,
    origin_airports: originAirports.length > 1 ? originAirports : [],
  };
}

/**
 * Round-trip fares around the asked dates: one query per month pair, kept when the departure AND the
 * return are each within 2 days of the asked ones. Exact matches first, then the closest dates.
 */
async function nearbyRoundRows(from: Place, to: Place, dep: string, ret: string): Promise<Row[]> {
  const fetchMonth = (a: string, b: string) =>
    queryMarkets(a, b, dep.slice(0, 7), ret.slice(0, 7), { all: 100, direct: 30 });
  let rows = await fetchMonth(from.code, to.code);
  const fromCity = from.type === "airport" && from.city_code && from.city_code !== from.code;
  const toCity = to.type === "airport" && to.city_code && to.city_code !== to.code;
  if (!rows.length && (fromCity || toCity)) {
    const wide = await fetchMonth(
      fromCity ? from.city_code : from.code,
      toCity ? to.city_code : to.code,
    );
    const exact = wide.filter(
      (r) =>
        (!fromCity || r["origin_airport"] === from.code) &&
        (!toCity || r["destination_airport"] === to.code),
    );
    rows = exact.length ? exact : wide;
  }
  const day = (v: unknown) => Date.parse(String(v ?? "").slice(0, 10) + "T00:00:00Z");
  const tD = day(dep),
    tR = day(ret);
  return rows
    .map((r) => {
      const d0 = day(r["departure_at"]),
        r0 = day(r["return_at"]);
      return {
        r,
        gd: Math.abs(d0 - tD) / 86_400_000,
        gr: Math.abs(r0 - tR) / 86_400_000,
        ok: r0 > d0,
      };
    })
    .filter((x) => x.ok && Number.isFinite(x.gd + x.gr) && x.gd <= 2 && x.gr <= 2)
    .sort((a, b) => a.gd + a.gr - (b.gd + b.gr) || Number(a.r["price"]) - Number(b.r["price"]))
    .map((x) => (x.gd + x.gr > 0 ? { ...x.r, __nearby: true } : x.r));
}

/**
 * Round-trip options built from one-way tickets when no round-trip fare is cached: every pair
 * (outbound, return) with price = sum, varied (no flight used more than twice), cheapest first.
 * The booking link is the Aviasales round-trip search for the exact dates, where the live price is shown.
 */
function combineLegs(
  outs: Opt[],
  backs: Opt[],
  max: number,
  c: { adults: number; searchUrl: string },
): Item[] {
  if (max <= 0) return [];
  const cheapFirst = (xs: Opt[]) => [...xs].sort((a, b) => a.price - b.price || a.dur - b.dur);
  const fastest = (xs: Opt[]) => [...xs].sort((a, b) => a.dur - b.dur || a.price - b.price)[0];
  const pool = (xs: Opt[], n: number) =>
    [...new Set([...cheapFirst(xs).slice(0, n), fastest(xs)!].filter(Boolean))] as Opt[];
  const pairs = pool(outs, 6)
    .flatMap((a) =>
      pool(backs, 5).map((b) => ({ a, b, price: a.price + b.price, dur: a.dur + b.dur })),
    )
    .sort((x, y) => x.price - y.price || x.dur - y.dur);
  const used = new Map<string, number>();
  const take = (k: string) => (used.get(k) ?? 0) < 2;
  const picked: typeof pairs = [];
  for (const p of pairs) {
    if (picked.length >= max) break;
    if (!take(p.a.item.id) || !take(p.b.item.id)) continue;
    picked.push(p);
    used.set(p.a.item.id, (used.get(p.a.item.id) ?? 0) + 1);
    used.set(p.b.item.id, (used.get(p.b.item.id) ?? 0) + 1);
  }
  for (const p of pairs) if (picked.length < max && !picked.includes(p)) picked.push(p);
  picked.sort((x, y) => x.price - y.price || x.dur - y.dur);
  const fastestPair = [...picked].sort((x, y) => x.dur - y.dur)[0];
  return picked.map((p) => {
    const a = p.a.item.attributes,
      b = p.b.item.attributes;
    const attrs: Record<string, unknown> = { ...a };
    for (const k of ["leg", "price_note", "tags", "nearby_date", "price_per_person"])
      delete attrs[k];
    const per = Math.round(p.price * 100) / 100;
    Object.assign(attrs, {
      trip: "round",
      return_date: b["departure_date"],
      return_departure_time: b["departure_time"],
      ...(b["arrival_time"] ? { return_arrival_time: b["arrival_time"] } : {}),
      ...(b["arrival_day_offset"] ? { return_arrival_day_offset: b["arrival_day_offset"] } : {}),
      return_stops: b["stops"],
      return_stops_label: b["stops_label"],
      ...(b["duration"] ? { return_duration: b["duration"] } : {}),
      return_airline: b["airline"],
      return_flight_number: b["flight_number"],
      return_from_airport: b["from_airport"],
      return_to_airport: b["to_airport"],
      price_per_person: per,
      outbound_price_per_person: p.a.price,
      return_price_per_person: p.b.price,
      passengers: c.adults,
      combined_one_way: true,
      price_note: "two one-way tickets (outbound + return)",
      ...(a["nearby_date"] || b["nearby_date"] ? { nearby_date: true } : {}),
    });
    const tags = [
      p === picked[0] ? "Cheapest" : "",
      p === fastestPair && p !== picked[0] ? "Fastest" : "",
      attrs["nearby_date"] ? "Nearby date" : "",
    ].filter(Boolean);
    if (tags.length) attrs["tags"] = tags;
    const id = `f_rt_${p.a.item.id.replace(/^f_o_/, "")}__${p.b.item.id.replace(/^f_r_/, "")}`;
    return {
      id,
      kind: "flight",
      title: `${a["departure_time"]} → ${a["arrival_time"] ?? "?"} · ${a["airline"]} + return ${b["departure_time"]}`,
      subtitle: [
        `${a["from_airport"]} → ${a["to_airport"]}`,
        "Round trip",
        String(a["stops_label"] ?? ""),
        `${a["departure_date"]} / ${b["departure_date"]}`,
      ]
        .filter(Boolean)
        .join(" · "),
      attributes: attrs,
      price: {
        amount: Math.round(per * c.adults * 100) / 100,
        currency: CONFIG.flights.currency.toUpperCase(),
      },
      source_url: c.searchUrl,
      verify: true,
      action: { label: "Book on Aviasales", type: "handoff_url", value: c.searchUrl },
    };
  });
}

// ---------- per-leg data ----------
type LegName = "round" | "oneway" | "outbound" | "return";
interface LegRows {
  rows: Row[];
  nearby: boolean;
  leg: LegName;
  from: Place;
  to: Place;
}

/**
 * Markets in order of preference. The Data API caches prices per market and the same ticket can carry
 * different prices in each. "us" (aviasales.com, USD) matched the live site in every case checked:
 * BAK-LIS Dec 29 us $254 = site $255; BAK-IST Nov 12-15 J2 8103 via TAS us $609 = site $609 while the
 * default market still had $646; the default market's VF 578 at $419 sold for $274. The next market is
 * used only when the previous one has nothing cached for the query.
 */
const MARKETS: (string | undefined)[][] = [["us"], [undefined], ["az"]];

/** One itinerary = the ticket code in its Aviasales link (flights + times of every segment). */
const ticketKey = (r: Row) =>
  `${String(r["link"] ?? "").match(/[?&]t=([^&_]+)/)?.[1] ?? ""}|${r["airline"]}${r["flight_number"]}|${r["departure_at"]}|${r["return_at"] ?? ""}`;

/** Direct and all-stops queries in parallel, market by market (see MARKETS). */
async function queryMarkets(
  from: string,
  to: string,
  dep: string,
  rt: string,
  limits: { all: number; direct: number } = { all: 30, direct: 15 },
): Promise<Row[]> {
  const attempt = async (markets: (string | undefined)[]) => {
    const settled = await Promise.allSettled(
      markets.flatMap((market) => [
        pricesForDates({
          origin: from,
          destination: to,
          depart: dep,
          ret: rt,
          direct: false,
          market,
          limit: limits.all,
        }),
        pricesForDates({
          origin: from,
          destination: to,
          depart: dep,
          ret: rt,
          direct: true,
          market,
          limit: limits.direct,
        }),
      ]),
    );
    // The same itinerary comes back from both the direct and all-stops queries, sometimes several
    // times with different cached prices: keep it once, at its lowest price.
    const best = new Map<string, Row>();
    for (const x of settled) {
      if (x.status !== "fulfilled") continue;
      for (const r of x.value) {
        const k = ticketKey(r);
        const had = best.get(k);
        if (!had || Number(r["price"]) < Number(had["price"])) best.set(k, r);
      }
    }
    const out = [...best.values()].sort((a, b) => Number(a["price"]) - Number(b["price"]));
    const failed = settled.find((x) => x.status === "rejected") as
      PromiseRejectedResult | undefined;
    if (!out.length && failed && settled.every((x) => x.status === "rejected")) throw failed.reason;
    return out;
  };
  let lastError: unknown = null;
  for (const markets of MARKETS) {
    try {
      const rows = await attempt(markets);
      if (rows.length) return rows;
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError) throw lastError;
  return [];
}

/** Cheapest cached one-way price per day of a month (Travelpayouts grouped_prices). */
async function pricesByDay(
  from: string,
  to: string,
  month: string,
  market?: string,
): Promise<Row[]> {
  const token = process.env["TRAVELPAYOUTS_TOKEN"];
  if (!token) throw new Error("TRAVELPAYOUTS_TOKEN is not set");
  const params = new URLSearchParams({
    origin: from,
    destination: to,
    departure_at: month,
    group_by: "departure_at",
    currency: CONFIG.flights.currency,
    token,
  });
  if (market) params.set("market", market);
  const url = `https://api.travelpayouts.com/aviasales/v3/grouped_prices?${params}`;
  return cached(`tpg:${url.replace(/token=[^&]+/, "")}`, CONFIG.flights.cacheMs, async () => {
    const body = (await tpGet(url)) as { data?: Record<string, Row> | Row[] };
    return Array.isArray(body.data) ? body.data : Object.values(body.data ?? {});
  });
}

/** How far (days) a "nearby date" may be from the asked one when the exact day has nothing cached. */
const NEAR_DAYS = 5;
const monthsAround = (date: string) => {
  const d = new Date(date + "T00:00:00Z");
  const m = new Set([date.slice(0, 7)]);
  for (const k of [-NEAR_DAYS, NEAR_DAYS])
    m.add(new Date(d.getTime() + k * 86_400_000).toISOString().slice(0, 7));
  return [...m];
};

/**
 * Rows for one direction (or a round trip when `rt` is set), most specific first:
 * exact date -> the airport's whole city (kept to that airport when possible) -> nearest cached dates (±NEAR_DAYS).
 */
async function legRows(
  from: Place,
  to: Place,
  dep: string,
  rt: string,
  allowNearby: boolean,
): Promise<Omit<LegRows, "leg">> {
  const base = { from, to, nearby: false };
  let rows = await queryMarkets(from.code, to.code, dep, rt);
  // An airport (e.g. FCO) has thinner cache than its city (ROM): query the city, keep that airport's flights.
  const fromCity = from.type === "airport" && from.city_code && from.city_code !== from.code;
  const toCity = to.type === "airport" && to.city_code && to.city_code !== to.code;
  if (!rows.length && (fromCity || toCity)) {
    const wide = await queryMarkets(
      fromCity ? from.city_code : from.code,
      toCity ? to.city_code : to.code,
      dep,
      rt,
    );
    const exact = wide.filter(
      (r) =>
        (!fromCity || r["origin_airport"] === from.code) &&
        (!toCity || r["destination_airport"] === to.code),
    );
    rows = exact.length ? exact : wide;
  }
  // The API must answer for the asked day(s); a row dated otherwise is a nearby date, never shown as
  // "your date". One-way legs must not use round-trip fares (their price covers both ways) and vice versa.
  rows = rows
    .filter((r) => (rt ? !!r["return_at"] : !r["return_at"]))
    .map((r) =>
      (dep.length === 10 && String(r["departure_at"] ?? "").slice(0, 10) !== dep) ||
      (rt.length === 10 && String(r["return_at"] ?? "").slice(0, 10) !== rt)
        ? { ...r, __nearby: true }
        : r,
    );
  if (rows.length || !allowNearby || dep.length !== 10) return { ...base, rows };

  // Nothing on that exact day: cheapest cached one-way flight per day, nearest days first
  // (max ±NEAR_DAYS days, 4 dates). Explicit one-way month queries, plus the per-day calendar
  // (grouped_prices) with any round-trip fares dropped so a both-ways price is never shown as one-way.
  const days: Row[] = [];
  const settled = await Promise.allSettled([
    ...monthsAround(dep).map((m) =>
      queryMarkets(from.code, to.code, m, "", { all: 300, direct: 100 }),
    ),
    ...monthsAround(dep).flatMap((m) => [
      ...MARKETS.flat().map((market, rank) =>
        pricesByDay(from.code, to.code, m, market).then((rs) =>
          rs.map((r) => ({ ...r, __rank: rank + 1 })),
        ),
      ),
    ]),
  ]);
  for (const x of settled)
    if (x.status === "fulfilled") days.push(...x.value.filter((r) => !r["return_at"]));
  const target = Date.parse(dep + "T00:00:00Z");
  const near = days
    .map((r) => ({
      r,
      gap:
        Math.abs(Date.parse(String(r["departure_at"] ?? "").slice(0, 10) + "T00:00:00Z") - target) /
        86_400_000,
    }))
    .filter((x) => Number.isFinite(x.gap) && x.gap <= NEAR_DAYS)
    // Per day: the preferred market first (month query rows are rank 0), others only for days it lacks.
    .sort(
      (a, b) =>
        a.gap - b.gap ||
        Number(a.r["__rank"] ?? 0) - Number(b.r["__rank"] ?? 0) ||
        Number(a.r["price"]) - Number(b.r["price"]),
    );
  const byDate = new Map<string, Row>();
  for (const x of near) {
    const day = String(x.r["departure_at"]).slice(0, 10);
    if (!byDate.has(day)) byDate.set(day, x.r);
  }
  return { ...base, rows: [...byDate.values()].slice(0, 4), nearby: byDate.size > 0 };
}

/**
 * Door-to-door minutes per direction from an Aviasales ticket link. Its `t=` value is the carrier,
 * then per direction: local departure (10-digit unix), local arrival (10), total minutes (6), airports,
 * e.g. "VF17985621001798748700003350GYDESBSTNLTNBCNLIS..." -> [3350]. [] when it cannot be read.
 */
export function ticketLegMinutes(link: string): number[] {
  const t = link.match(/[?&]t=([^&]+)/)?.[1];
  if (!t) return [];
  const out: number[] = [];
  for (const m of t.slice(2).matchAll(/(?:^|[A-Z])(1\d{9})(1\d{9})(\d{6})(?=[A-Z])/g)) {
    const span = (Number(m[2]) - Number(m[1])) / 60; // local-to-local, so off by the time-zone gap
    const min = Number(m[3]);
    if (min > 0 && Math.abs(min - span) <= 15 * 60) out.push(min);
  }
  return out;
}

type Opt = {
  item: Item;
  depMin: number;
  price: number;
  dur: number;
  stops: number;
  /** Stops of the return flight (round-trip fares), for "direct only". */
  retStops?: number;
};

function buildOptions(
  L: LegRows,
  c: {
    adults: number;
    searchUrl: string;
    aps: Map<string, Airport>;
    als: Map<string, string>;
    ret: boolean;
  },
): Opt[] {
  const { adults, aps, als } = c;
  const seen = new Set<string>();
  const opts: Opt[] = [];
  const legLabel = L.leg === "outbound" ? "Outbound" : L.leg === "return" ? "Return" : "";
  for (const f of L.rows) {
    const depIso = String(f["departure_at"] ?? "");
    const dep = localParts(depIso);
    const price = Number(f["price"]);
    if (!dep || !Number.isFinite(price)) continue;
    const airline = String(f["airline"] ?? "");
    const num = String(f["flight_number"] ?? "");
    const key = ticketKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    const stops = Number(f["transfers"] ?? 0);
    const retStopsRaw = Number(f["return_transfers"] ?? 0);
    // Real door-to-door time per direction (layovers included). `duration_to` / `duration_back` are
    // flight time only (BAK-LIS 3 stops: duration_to 680 = "11h 20m" while the trip is 2d 7h 50m), so
    // they are used only as a last resort. Order: the ticket link's own per-direction minutes ->
    // `duration` (one-way: the whole trip; round trip: both ways, minus the other direction).
    const fromLink = ticketLegMinutes(String(f["link"] ?? ""));
    const total = Number(f["duration"] ?? 0);
    let durTo = fromLink[0] ?? 0;
    let durBack = c.ret ? (fromLink[1] ?? 0) : 0;
    if (!c.ret) durTo ||= total;
    else {
      if (!durTo && stops === 0) durTo = Number(f["duration_to"] ?? 0);
      if (!durBack && retStopsRaw === 0) durBack = Number(f["duration_back"] ?? 0);
      if (!durTo && durBack && total > durBack) durTo = total - durBack;
      if (!durBack && durTo && total > durTo) durBack = total - durTo;
    }
    durTo ||= Number(f["duration_to"] ?? 0);
    const fromAp = String(f["origin_airport"] ?? L.from.code);
    const toAp = String(f["destination_airport"] ?? L.to.code);
    // Arrival = departure instant + flight time, shown in the destination airport's time zone.
    let arrival: { date: string; time: string } | null = null;
    let arrivalApprox = false;
    if (durTo > 0) {
      const ms = Date.parse(depIso) + durTo * 60_000;
      const tz = aps.get(toAp)?.tz;
      arrival = tz ? inZone(ms, tz) : null;
      if (!arrival) {
        const local = ms + dep.offsetMin * 60_000;
        arrival = {
          date: new Date(local).toISOString().slice(0, 10),
          time: new Date(local).toISOString().slice(11, 16),
        };
        arrivalApprox = true;
      }
    }
    const stopsLabel = stops === 0 ? "Direct" : stops === 1 ? "1 stop" : `${stops} stops`;
    const rowNearby = L.nearby || f["__nearby"] === true;
    const fallbackUrl = withMarker(aviasalesPath(L.from.code, L.to.code, dep.date, "", adults));
    const link = f["link"]
      ? withMarker(
          String(f["link"]).replace(
            /^(\/search\/[A-Z]{3}\d{4}[A-Z]{3}(?:\d{4})?)\d/,
            `$1${adults}`,
          ),
        )
      : L.leg === "round" || L.leg === "oneway"
        ? c.searchUrl
        : fallbackUrl;
    const attrs: Record<string, unknown> = {
      ...(legLabel ? { leg: legLabel } : {}),
      departure_date: dep.date,
      departure_time: dep.time,
      ...(arrival ? { arrival_date: arrival.date, arrival_time: arrival.time } : {}),
      ...(arrival && dayDiff(dep.date, arrival.date) > 0
        ? { arrival_day_offset: dayDiff(dep.date, arrival.date) }
        : {}),
      ...(arrivalApprox ? { arrival_time_note: "origin time zone" } : {}),
      ...(rowNearby ? { nearby_date: true } : {}),
      from_airport: fromAp,
      to_airport: toAp,
      ...(aps.get(fromAp) ? { from_airport_name: aps.get(fromAp)!.name } : {}),
      ...(aps.get(toAp) ? { to_airport_name: aps.get(toAp)!.name } : {}),
      duration: durationLabel(durTo),
      stops,
      stops_label: stopsLabel,
      airline: als.get(airline) ?? airline,
      flight_number: `${airline} ${num}`.trim(),
      price_per_person: price,
      passengers: adults,
      ...(legLabel ? { price_note: "one-way price" } : {}),
    };
    const retIso = String(f["return_at"] ?? "");
    const retDep = retIso && c.ret ? localParts(retIso) : null;
    let retStops: number | undefined;
    if (retDep) {
      // Round-trip fare: one price for both directions (Aviasales prices_for_dates with return_at).
      const back = durBack || Number(f["duration_back"] ?? 0);
      attrs["trip"] = "round";
      attrs["price_note"] = "for the round trip (both ways)";
      attrs["return_date"] = retDep.date;
      attrs["return_departure_time"] = retDep.time;
      attrs["return_from_airport"] = toAp;
      attrs["return_to_airport"] = fromAp;
      retStops = retStopsRaw;
      attrs["return_stops"] = retStops;
      attrs["return_stops_label"] =
        retStops === 0 ? "Direct" : retStops === 1 ? "1 stop" : `${retStops} stops`;
      if (back > 0) {
        const tz = aps.get(fromAp)?.tz;
        const a = tz ? inZone(Date.parse(retIso) + back * 60_000, tz) : null;
        if (a) {
          attrs["return_arrival_time"] = a.time;
          const off = dayDiff(retDep.date, a.date);
          if (off > 0) attrs["return_arrival_day_offset"] = off;
        }
        attrs["return_duration"] = durationLabel(back);
      }
    }
    const id = `f_${legLabel ? legLabel[0]!.toLowerCase() + "_" : ""}${airline}${num}_${dep.date.slice(5)}_${dep.time.replace(":", "")}${retDep ? "_r" + retDep.date.slice(5) + "_" + retDep.time.replace(":", "") : ""}`;
    opts.push({
      depMin: toMin(dep.time) ?? 0,
      price,
      // Round trips compete on the time of both ways together.
      dur: (c.ret ? durTo + durBack : durTo) || 99_999,
      stops,
      ...(retStops != null ? { retStops } : {}),
      item: {
        id,
        kind: "flight",
        title: `${dep.time} → ${arrival?.time ?? "?"} · ${als.get(airline) ?? airline}`,
        subtitle: [
          legLabel,
          `${fromAp} → ${toAp}`,
          stopsLabel,
          durationLabel(durTo),
          rowNearby || legLabel ? dep.date : "",
        ]
          .filter(Boolean)
          .join(" · "),
        attributes: attrs,
        price: {
          amount: Math.round(price * adults * 100) / 100,
          currency: CONFIG.flights.currency.toUpperCase(),
        },
        source_url: link,
        verify: true, // cached "from" prices
        action: { label: "Book on Aviasales", type: "handoff_url", value: link },
      },
    });
  }
  return opts;
}

/** A varied set: cheapest, cheapest direct, fastest, cheapest with stops, then spread over the day. */
function pickVaried(kept: Opt[], max: number, leg: LegName): Item[] {
  const picked = new Map<string, Opt>();
  // Never replace an option already picked (same id = same card): the cheaper one stays.
  const add = (x?: Opt) =>
    x && picked.size < max && !picked.has(x.item.id) && picked.set(x.item.id, x);
  const byPrice = [...kept].sort((a, b) => a.price - b.price || a.dur - b.dur);
  add(byPrice[0]);
  add(byPrice.find((x) => x.stops === 0));
  add([...kept].sort((a, b) => a.dur - b.dur || a.price - b.price)[0]);
  add(byPrice.find((x) => x.stops > 0));
  const byTime = [...kept].sort((a, b) => a.depMin - b.depMin);
  const step = Math.max(1, Math.floor(byTime.length / Math.max(1, max)));
  for (let i = 0; picked.size < max && i < byTime.length; i++)
    add(byTime[(i * step) % byTime.length]);
  for (const x of byPrice) add(x);
  const cheapest = byPrice[0]?.item.id;
  const fastest = [...kept].sort((a, b) => a.dur - b.dur)[0]?.item.id;
  const legTag = leg === "outbound" ? "Outbound" : leg === "return" ? "Return" : "";
  return [...picked.values()]
    .sort(
      (a, b) =>
        (a.item.attributes["departure_date"] as string).localeCompare(
          b.item.attributes["departure_date"] as string,
        ) || a.depMin - b.depMin,
    )
    .map((x) => {
      const tags = [
        legTag,
        x.item.id === cheapest ? "Cheapest" : "",
        x.item.id === fastest ? "Fastest" : "",
        x.item.attributes["nearby_date"] ? "Nearby date" : "",
      ].filter(Boolean);
      return tags.length ? { ...x.item, attributes: { ...x.item.attributes, tags } } : x.item;
    });
}

export const _test = { localParts, inZone, cache };
