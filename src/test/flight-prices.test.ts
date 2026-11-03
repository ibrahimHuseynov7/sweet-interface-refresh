// Aviasales (Travelpayouts) price reading: wrong-direction fares, off-date rows, rate limits, tags.
import { afterAll, beforeEach, describe, expect, it } from "vitest";

type Row = Record<string, unknown>;
const realFetch = globalThis.fetch;
let handler: (q: URLSearchParams, url: string) => Response | undefined;
let calls: string[] = [];

const row = (o: Partial<Row>): Row => ({
  origin: "BAK",
  destination: "LIS",
  origin_airport: "GYD",
  destination_airport: "LIS",
  airline: "TK",
  flight_number: "1",
  transfers: 1,
  return_transfers: 0,
  duration_to: 590,
  link: "/search/GYD2912LIS1?t=x",
  ...o,
});

beforeEach(() => {
  calls = [];
  process.env["TRAVELPAYOUTS_TOKEN"] = "tp-test";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    if (url.startsWith("https://autocomplete.travelpayouts.com/places2")) {
      const term = decodeURIComponent(url.split("term=")[1] ?? "").toLowerCase();
      const code = term.startsWith("bak")
        ? "BAK"
        : term.startsWith("lis")
          ? "LIS"
          : term.startsWith("ist")
            ? "IST"
            : "";
      return Response.json(
        code ? [{ code, type: "city", name: term, city_code: code, country_code: "" }] : [],
      );
    }
    if (url.includes("/data/en/airports.json"))
      return Response.json([
        { code: "GYD", name: "Heydar Aliyev", city_code: "BAK", time_zone: "Asia/Baku" },
        { code: "LIS", name: "Lisbon", city_code: "LIS", time_zone: "Europe/Lisbon" },
      ]);
    if (url.includes("/data/en/airlines.json")) return Response.json([]);
    const res = handler(new URL(url).searchParams, url);
    return res ?? Response.json({ success: true, data: [] });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("Aviasales price reading", () => {
  it("never shows a round-trip fare as a one-way price, and flags rows not on the asked day", async () => {
    const { searchFlightOptions } = await import("@/lib/assistant/tools/flights");
    handler = (q, url) => {
      if (!url.includes("prices_for_dates") || q.get("departure_at") !== "2026-12-29") return;
      return Response.json({
        success: true,
        data: [
          // A round-trip fare leaking into a one-way answer: cheaper, but covers both ways.
          row({
            price: 150,
            departure_at: "2026-12-29T08:00:00+04:00",
            return_at: "2027-01-05T10:00:00+00:00",
          }),
          row({ price: 255, flight_number: "2", departure_at: "2026-12-29T16:35:00+04:00" }),
          row({ price: 230, flight_number: "3", departure_at: "2026-12-30T09:00:00+04:00" }),
        ],
      });
    };
    const r = await searchFlightOptions({
      origin: "Baku",
      destination: "Lisbon",
      depart: "2026-12-29",
      return: "",
      adults: 1,
    });
    const prices = r.items.map((i) => i.attributes["price_per_person"]);
    expect(prices).not.toContain(150);
    const exact = r.items.find((i) => i.attributes["price_per_person"] === 255)!;
    const other = r.items.find((i) => i.attributes["price_per_person"] === 230)!;
    expect(exact.attributes["nearby_date"]).toBeUndefined();
    expect(other.attributes["nearby_date"]).toBe(true);
  });

  it("retries a rate-limited (429) price query instead of reporting no flights", async () => {
    const { searchFlightOptions } = await import("@/lib/assistant/tools/flights");
    let hits = 0;
    handler = (q, url) => {
      if (!url.includes("prices_for_dates") || q.get("departure_at") !== "2026-12-20") return;
      if (q.get("direct") === "true") return;
      hits++;
      if (hits === 1) return new Response("Too Many Requests", { status: 429 });
      return Response.json({
        success: true,
        data: [row({ price: 280, departure_at: "2026-12-20T16:35:00+04:00" })],
      });
    };
    const r = await searchFlightOptions({
      origin: "Baku",
      destination: "Lisbon",
      depart: "2026-12-20",
      return: "",
      adults: 1,
    });
    expect(r.items.map((i) => i.attributes["price_per_person"])).toContain(280);
    expect(r.error).toBeUndefined();
  });

  it("finds the nearest cached day up to 5 days away (one-way month query)", async () => {
    const { searchFlightOptions } = await import("@/lib/assistant/tools/flights");
    handler = (q, url) => {
      if (!url.includes("prices_for_dates") || q.get("departure_at") !== "2027-01") return;
      if (q.get("one_way") !== "true") return;
      return Response.json({
        success: true,
        data: [
          row({
            origin: "LIS",
            destination: "BAK",
            origin_airport: "LIS",
            destination_airport: "GYD",
            price: 310,
            departure_at: "2027-01-27T11:00:00+00:00",
          }),
        ],
      });
    };
    const r = await searchFlightOptions({
      origin: "Lisbon",
      destination: "Baku",
      depart: "2027-01-23",
      return: "",
      adults: 1,
    });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.attributes["departure_date"]).toBe("2027-01-27");
    expect(r.items[0]!.attributes["nearby_date"]).toBe(true);
  });

  it("reads the door-to-door duration, not flight time only (live BAK-LIS row: 2d 7h 50m, not 11h 20m)", async () => {
    const { searchFlightOptions, ticketLegMinutes } = await import("@/lib/assistant/tools/flights");
    expect(
      ticketLegMinutes(
        "/search/BAK2912LIS03011?t=VF17985621001798748700003350GYDESBSTNLTNBCNLIS1799005200179910300000139",
      ),
    ).toEqual([3350]);
    handler = (q, url) => {
      if (!url.includes("prices_for_dates") || q.get("departure_at") !== "2026-12-28") return;
      return Response.json({
        success: true,
        data: [
          row({
            price: 289,
            airline: "VF",
            flight_number: "578",
            transfers: 3,
            departure_at: "2026-12-28T16:35:00+04:00",
            duration: 3350,
            duration_to: 680,
            link: "/search/BAK2812LIS1?t=VF17984757001798662300003350GYDESBSTNLTNBCNLIS",
          }),
        ],
      });
    };
    const r = await searchFlightOptions({
      origin: "Baku",
      destination: "Lisbon",
      depart: "2026-12-28",
      return: "",
      adults: 1,
    });
    expect(r.items[0]!.attributes["duration"]).toBe("55h 50m");
    expect(r.items[0]!.attributes["arrival_time"]).toBe("20:25");
    expect(r.items[0]!.attributes["arrival_day_offset"]).toBe(2);
  });

  it("prices come from the aviasales.com (us) market; the cheaper of two same-flight round trips is kept", async () => {
    const { searchFlightOptions } = await import("@/lib/assistant/tools/flights");
    const rt = (price: number, ret: string, t: string) =>
      row({
        origin: "BAK",
        destination: "IST",
        destination_airport: "SAW",
        airline: "VF",
        flight_number: "180",
        transfers: 0,
        price,
        departure_at: "2026-11-12T05:50:00+04:00",
        return_at: `2026-11-15T${ret}:00+03:00`,
        link: `/search/BAK1211IST15111?t=${t}_abc`,
      });
    handler = (q, url) => {
      if (!url.includes("prices_for_dates") || q.get("return_at") !== "2026-11-15") return;
      if (q.get("market") === "us")
        return Response.json({
          success: true,
          data: [
            rt(267, "18:45", "VF1794462600179447070000019502"),
            rt(237, "07:40", "VF1794462600179447070000019501"),
          ],
        });
      // Default market: an older, higher price for the same ticket.
      return Response.json({
        success: true,
        data: [rt(419, "07:40", "VF1794462600179447070000019501")],
      });
    };
    const r = await searchFlightOptions({
      origin: "Baku",
      destination: "Istanbul",
      depart: "2026-11-12",
      return: "2026-11-15",
      adults: 1,
    });
    const prices = r.items.map((i) => i.attributes["price_per_person"]).sort();
    expect(prices).toEqual([237, 267]);
    expect(calls.some((u) => u.includes("market=us"))).toBe(true);
  });

  it("finds round trips longer than 30 days (the API rejects them as one query) instead of 'unavailable'", async () => {
    const { searchFlightOptions } = await import("@/lib/assistant/tools/flights");
    handler = (q, url) => {
      if (!url.includes("prices_for_dates") || q.get("departure_at") !== "2026-11-05") return;
      const ret = q.get("return_at");
      if (ret === "2026-12-14")
        return Response.json(
          {
            error:
              "bad request: departure_at: diff between max depart date and min return date exceeds supported maximum of 30.",
            data: null,
            status: 400,
            success: false,
          },
          { status: 400 },
        );
      if (ret === "2026-12")
        return Response.json({
          success: true,
          data: [
            row({
              destination: "IST",
              destination_airport: "SAW",
              airline: "VF",
              flight_number: "180",
              transfers: 0,
              price: 255,
              departure_at: "2026-11-05T05:50:00+04:00",
              return_at: "2026-12-14T07:40:00+03:00",
              link: "/search/BAK0511IST14121?t=VF1",
            }),
            row({
              destination: "IST",
              destination_airport: "SAW",
              airline: "VF",
              flight_number: "180",
              transfers: 0,
              price: 199,
              departure_at: "2026-11-05T05:50:00+04:00",
              return_at: "2026-12-10T07:40:00+03:00",
              link: "/search/BAK0511IST10121?t=VF2",
            }),
          ],
        });
      return undefined;
    };
    const r = await searchFlightOptions({
      origin: "Baku",
      destination: "Istanbul",
      depart: "2026-11-05",
      return: "2026-12-14",
      adults: 1,
    });
    expect(r.error).toBeUndefined();
    expect(
      r.items.map((i) => [i.attributes["return_date"], i.attributes["price_per_person"]]),
    ).toEqual([["2026-12-14", 255]]);
  });

  it("'Cheapest' is tagged per comparable group: outbound and return legs are not compared", async () => {
    const { tagFlights } = await import("@/lib/assistant/agents/module_agent");
    const f = (id: string, per: number, attrs: Row) => ({
      id,
      kind: "flight",
      title: id,
      subtitle: "",
      attributes: {
        departure_time: "10:00",
        duration: "5h 00m",
        price_per_person: per,
        ...attrs,
      } as Row,
      price: { amount: per, currency: "USD" },
      source_url: "https://www.aviasales.com/",
      verify: true,
      action: { label: "Book", type: "handoff_url" as const, value: "https://www.aviasales.com/" },
    });
    const items = [
      f("out1", 236, { leg: "Outbound" }),
      f("out2", 300, { leg: "Outbound" }),
      f("back1", 180, { leg: "Return" }),
    ];
    tagFlights(items);
    expect(items[0]!.attributes["tags"]).toEqual(["Cheapest"]);
    expect(items[1]!.attributes["tags"]).toBeUndefined();
    expect(items[2]!.attributes["tags"]).toEqual(["Cheapest"]);
  });
});
