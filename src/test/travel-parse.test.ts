// @vitest-environment node
// Route and date understanding done in code (Azerbaijani with/without special letters, Russian, English, Turkish).
import { describe, expect, it } from "vitest";
import {
  cityKey,
  encodeDateHint,
  isoDatesOf,
  parseDates,
  parseRoute,
  parseTravelers,
  wantsOtherDates,
} from "@/lib/assistant/core/travel";

const TODAY = "2026-11-02";

describe("parseRoute: origin and destination are never swapped", () => {
  it.each([
    ["mene bakidan londona bilet lazimdi", "Baku", "London"],
    ["Mənə Bakıdan Londona bilet lazımdır", "Baku", "London"],
    ["Şanxaydan Bakıya bilet tap", "Shanghai", "Baku"],
    ["shanxaydan bakiya bilet", "Shanghai", "Baku"],
    ["Bakıya Şanxaydan bilet", "Shanghai", "Baku"],
    ["find me a ticket from shanghai to baku", "Shanghai", "Baku"],
    ["to Baku from Shanghai", "Shanghai", "Baku"],
    ["Shanghai to Baku", "Shanghai", "Baku"],
    ["Baku - London", "Baku", "London"],
    ["из Шанхая в Баку", "Shanghai", "Baku"],
    ["билет из Москвы в Стамбул", "Moscow", "Istanbul"],
    ["İstanbuldan Antalyaya", "Istanbul", "Antalya"],
  ])("%s", (text, origin, destination) => {
    expect(parseRoute(text)).toEqual({ origin, destination });
  });

  it("one city with a direction", () => {
    expect(parseRoute("londona getmek isteyirem")).toEqual({ destination: "London" });
    expect(parseRoute("I wanna go to Paris")).toEqual({ destination: "Paris" });
    expect(parseRoute("Bakıdan bilet")).toEqual({ origin: "Baku" });
  });

  it("a lone city without a direction is not guessed", () => {
    expect(parseRoute("Milan")).toEqual({});
  });

  it("everyday words are not cities", () => {
    expect(parseRoute("parisian romantic market nice")).toEqual({});
  });

  it("cityKey folds spellings", () => {
    expect(cityKey("Şanxay")).toBe("Shanghai");
    expect(cityKey("Шанхай")).toBe("Shanghai");
    expect(cityKey("Bakı")).toBe("Baku");
    expect(cityKey("visa-free")).toBeNull();
  });
});

describe("parseDates", () => {
  it.each([
    ["3 noyabr gedirem 11 noyabr gayidiram", "2026-11-03", "2026-11-11"],
    ["3 noyabr gedirəm 11 noyabr qayıdıram", "2026-11-03", "2026-11-11"],
    ["getmek 4noyabr gayitmaq 10 noyabr", "2026-11-04", "2026-11-10"],
    ["3-11 noyabr", "2026-11-03", "2026-11-11"],
    ["с 3 по 11 ноября", "2026-11-03", "2026-11-11"],
    ["5-12 декабря", "2026-12-05", "2026-12-12"],
    ["Nov 3 - Nov 11", "2026-11-03", "2026-11-11"],
    ["03.11 - 11.11", "2026-11-03", "2026-11-11"],
    ["2026-11-03/2026-11-11", "2026-11-03", "2026-11-11"],
    ["28 dekabr - 4 yanvar", "2026-12-28", "2027-01-04"],
  ])("%s", (text, depart, ret) => {
    const p = parseDates(text, TODAY);
    expect(p.depart).toBe(depart);
    expect(p.ret).toBe(ret);
  });

  it("past days roll over to next year; one way keeps one date", () => {
    expect(parseDates("1 noyabr", TODAY).depart).toBe("2027-11-01");
    const p = parseDates("one way to London on 5 december", TODAY);
    expect(p).toMatchObject({ depart: "2026-12-05", mode: "oneway" });
    expect(p.ret).toBeUndefined();
  });

  it("holiday or month without days -> calendar month hint", () => {
    expect(parseDates("Novruzda Dubaya", TODAY)).toEqual({
      month: "2027-03",
      highlight: ["2027-03-20", "2027-03-24"],
      holiday: "Novruz",
    });
    expect(parseDates("martda Romaya", TODAY)).toEqual({ month: "2027-03" });
    expect(parseDates("в мае", TODAY)).toEqual({ month: "2027-05" });
    // Not months: "Mayami" (Miami), "marka", the English verb "may".
    expect(parseDates("Mayamiyə bilet", TODAY)).toEqual({});
    expect(parseDates("I may go", TODAY)).toEqual({});
  });

  it("flexible and times are not dates", () => {
    expect(parseDates("fərqi yoxdur", TODAY)).toEqual({ flexible: true });
    expect(parseDates("after 19.00", TODAY)).toEqual({});
  });

  it("round trip intent without a return day", () => {
    expect(parseDates("3 noyabr gedib qayıtmaq istəyirəm", TODAY)).toMatchObject({
      depart: "2026-11-03",
      mode: "round",
    });
  });
});

describe("helpers", () => {
  it("wantsOtherDates", () => {
    for (const t of [
      "i want different date",
      "change the dates",
      "other dates",
      "başqa tarix istəyirəm",
      "basqa tarixe bax",
      "tarixi dəyiş",
      "tarixleri deyisim",
      "другие даты",
      "поменять дату",
      "başka tarih",
    ])
      expect(wantsOtherDates(t)).toBe(true);
    for (const t of ["3 noyabr", "cheaper", "direct only", "London"])
      expect(wantsOtherDates(t)).toBe(false);
  });
  it("isoDatesOf", () => {
    expect(isoDatesOf("2026-11-03/2026-11-11")).toEqual({
      depart: "2026-11-03",
      ret: "2026-11-11",
    });
    expect(isoDatesOf("2026-11-03")).toEqual({ depart: "2026-11-03", ret: "" });
    expect(isoDatesOf("Novruz holidays")).toBeNull();
  });
  it("parseTravelers", () => {
    expect(parseTravelers("2 nəfər üçün")).toBe(2);
    expect(parseTravelers("iki nefer")).toBe(2);
    expect(parseTravelers("for 3 people")).toBe(3);
    expect(parseTravelers("на двоих")).toBe(2);
    expect(parseTravelers("bilet")).toBeNull();
  });
  it("encodeDateHint", () => {
    expect(
      encodeDateHint({
        month: "2027-03",
        mode: "round",
        highlight: ["2027-03-20", "2027-03-24"],
        holiday: "Novruz",
      }),
    ).toBe("m=2027-03;mode=round;hl=2027-03-20..2027-03-24;name=Novruz");
  });
});
