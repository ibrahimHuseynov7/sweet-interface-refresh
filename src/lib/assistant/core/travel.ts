// Travel understanding in code (not the model): which city is the ORIGIN and which is the DESTINATION,
// and which exact dates were asked for. Language models sometimes swap "from Shanghai to Baku" into
// Baku -> Shanghai or keep "3 noyabr ... 11 noyabr" as free text; these parsers make that deterministic.
// Supports Azerbaijani (with or without Azerbaijani letters), Russian, English and Turkish.

// ---------------------------------------------------------------------------------------------
// Text folding: "Bakıdan" / "bakidan" / "Şanxaydan" / "shanxaydan" all fold to the same letters.
// ---------------------------------------------------------------------------------------------
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/\u0307/g, "") // "İ".toLowerCase() leaves a combining dot
    .replace(/ə/g, "e")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/â/g, "a")
    .replace(/q/g, "g") // colloquial "gayidiram" = "qayıdıram"
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/kh/g, "h")
    .replace(/x/g, "h")
    .replace(/[’`ʼ]/g, "'");
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------------------------
// Gazetteer: English name (what the flight search understands best) + spellings people type.
// Russian entries are stems (case endings follow: "из Шанхая", "в Москву").
// Ambiguous everyday words (Nice, Male, Van, Bar...) are deliberately left out.
// ---------------------------------------------------------------------------------------------
type City = { en: string; latin: string[]; ru: string[] };
const C = (en: string, latin: string[], ru: string[] = []): City => ({ en, latin, ru });
const GAZETTEER: City[] = [
  C("Baku", ["baku", "bakı", "baki", "bakü"], ["баку"]),
  C("Ganja", ["ganja", "gəncə", "gence", "gyandja"], ["гянджа", "гяндж"]),
  C("Nakhchivan", ["nakhchivan", "naxçıvan", "nahcivan", "nakhichevan"], ["нахчыван", "нахичеван"]),
  C("Lankaran", ["lankaran", "lənkəran"], ["ленкоран"]),
  C("Gabala", ["gabala", "qəbələ"], ["габал"]),
  C("Zagatala", ["zagatala", "zaqatala"], ["закатал"]),
  C("Istanbul", ["istanbul", "stambul", "i̇stanbul"], ["стамбул"]),
  C("Ankara", ["ankara"], ["анкар"]),
  C("Antalya", ["antalya"], ["анталь", "анталий"]),
  C("Izmir", ["izmir"], ["измир"]),
  C("Bodrum", ["bodrum"], ["бодрум"]),
  C("Dalaman", ["dalaman"], ["даламан"]),
  C("Trabzon", ["trabzon"], ["трабзон"]),
  C("Kayseri", ["kayseri"], []),
  C("Tbilisi", ["tbilisi", "tiflis"], ["тбилис"]),
  C("Batumi", ["batumi", "batum"], ["батуми"]),
  C("Kutaisi", ["kutaisi"], ["кутаис"]),
  C("Yerevan", ["yerevan", "irevan"], ["ереван"]),
  C("Moscow", ["moscow", "moskva", "moskova"], ["москв"]),
  C(
    "Saint Petersburg",
    [
      "saint petersburg",
      "st petersburg",
      "sankt-peterburg",
      "sankt peterburg",
      "peterburg",
      "piter",
    ],
    ["санкт-петербург", "петербург", "питер"],
  ),
  C("Kazan", ["kazan"], ["казан"]),
  C("Sochi", ["sochi", "soçi", "soci"], ["сочи"]),
  C("Mineralnye Vody", ["mineralnye vody", "mineralniye vodi"], ["минеральные воды", "минводы"]),
  C("Makhachkala", ["makhachkala", "mahaçqala", "mahackala"], ["махачкал"]),
  C("Kaliningrad", ["kaliningrad"], ["калининград"]),
  C("Yekaterinburg", ["yekaterinburg", "ekaterinburg"], ["екатеринбург"]),
  C("Novosibirsk", ["novosibirsk"], ["новосибирск"]),
  C("Kyiv", ["kyiv", "kiev", "kiyev"], ["киев"]),
  C("Minsk", ["minsk"], ["минск"]),
  C("Tashkent", ["tashkent", "daşkənd", "taskent", "toshkent"], ["ташкент"]),
  C("Samarkand", ["samarkand", "səmərqənd", "semerkand"], ["самарканд"]),
  C("Almaty", ["almaty", "alma-ata", "almati"], ["алмат", "алма-ат"]),
  C("Astana", ["astana"], ["астан"]),
  C("Aktau", ["aktau", "aktav"], ["актау"]),
  C("Bishkek", ["bishkek", "bişkek"], ["бишкек"]),
  C("Ashgabat", ["ashgabat", "aşqabad", "asgabat"], ["ашхабад"]),
  C("Dushanbe", ["dushanbe", "düşənbə"], ["душанбе"]),
  C("Tehran", ["tehran", "tehran"], ["тегеран"]),
  C("Tabriz", ["tabriz", "təbriz"], ["тебриз"]),
  C("Mashhad", ["mashhad", "məşhəd"], ["мешхед"]),
  C("Dubai", ["dubai", "dubay"], ["дуба"]),
  C(
    "Abu Dhabi",
    ["abu dhabi", "abu-dhabi", "abu dabi", "abu-dabi", "əbu-dabi"],
    ["абу-даби", "абу даби"],
  ),
  C("Sharjah", ["sharjah", "şarja", "sarja"], ["шардж"]),
  C("Doha", ["doha", "doha"], ["доха", "дох"]),
  C("Riyadh", ["riyadh", "ər-riyad", "riyad"], ["эр-рияд", "рияд"]),
  C("Jeddah", ["jeddah", "ciddə", "cidde"], ["джидд"]),
  C("Medina", ["medina", "mədinə"], ["медин"]),
  C("Muscat", ["muscat", "məskət", "maskat"], ["маскат"]),
  C("Bahrain", ["bahrain", "bəhreyn"], ["бахрейн"]),
  C("Kuwait", ["kuwait", "küveyt"], ["кувейт"]),
  C("Amman", ["amman"], ["амман"]),
  C("Beirut", ["beirut", "beyrut"], ["бейрут"]),
  C("Tel Aviv", ["tel aviv", "tel-aviv", "tel-əviv"], ["тель-авив", "тель авив"]),
  C("Cairo", ["cairo", "qahirə", "qahire", "kahire"], ["каир"]),
  C(
    "Sharm El Sheikh",
    ["sharm el sheikh", "sharm el-sheikh", "şarm-əl-şeyx", "sarm el seyh", "sharm"],
    ["шарм-эль-шейх", "шарм эль шейх", "шарм"],
  ),
  C("Hurghada", ["hurghada", "hurqada", "hurgada"], ["хургад"]),
  C("Casablanca", ["casablanca", "kasablanka"], ["касабланк"]),
  C("London", ["london", "londra"], ["лондон"]),
  C("Manchester", ["manchester", "mançester"], ["манчестер"]),
  C("Edinburgh", ["edinburgh", "edinburq"], ["эдинбург"]),
  C("Dublin", ["dublin"], ["дублин"]),
  C("Paris", ["paris"], ["париж"]),
  C("Nice", ["nitstsa", "nissa"], ["ницц"]),
  C("Berlin", ["berlin"], ["берлин"]),
  C("Munich", ["munich", "münhen", "munhen", "münchen"], ["мюнхен"]),
  C("Frankfurt", ["frankfurt"], ["франкфурт"]),
  C("Hamburg", ["hamburg"], ["гамбург"]),
  C("Dusseldorf", ["dusseldorf", "düsseldorf"], ["дюссельдорф"]),
  C("Cologne", ["cologne", "köln", "koln"], ["кельн"]),
  C("Rome", ["rome", "roma"], ["рим"]),
  C("Milan", ["milan", "milano"], ["милан"]),
  C("Venice", ["venice", "venesiya", "venezia"], ["венеци"]),
  C("Florence", ["florence", "florensiya", "firenze"], ["флоренци"]),
  C("Naples", ["naples", "napoli"], ["неапол"]),
  C("Madrid", ["madrid"], ["мадрид"]),
  C("Barcelona", ["barcelona", "barselona"], ["барселон"]),
  C("Lisbon", ["lisbon", "lissabon", "lizbon"], ["лиссабон"]),
  C("Porto", ["porto"], ["порту"]),
  C("Amsterdam", ["amsterdam"], ["амстердам"]),
  C("Brussels", ["brussels", "brüssel", "brussel", "bruksel"], ["брюссел"]),
  C("Vienna", ["vienna", "vyana", "wien", "viyana"], ["вена", "вену", "вены"]),
  C("Prague", ["prague", "praqa", "praha", "prag"], ["праг"]),
  C("Budapest", ["budapest", "budapeşt", "budapesht"], ["будапешт"]),
  C("Warsaw", ["warsaw", "varşava", "varsova"], ["варшав"]),
  C("Krakow", ["krakow", "krakov"], ["краков"]),
  C("Bucharest", ["bucharest", "buxarest", "bükreş"], ["бухарест"]),
  C("Sofia", ["sofia", "sofiya"], ["софи"]),
  C("Belgrade", ["belgrade", "belqrad", "belgrad"], ["белград"]),
  C("Athens", ["athens", "afina", "atina"], ["афин"]),
  C("Zurich", ["zurich", "zürix", "zurih", "zürich"], ["цюрих"]),
  C("Geneva", ["geneva", "cenevrə", "cenevre", "jeneva"], ["женев"]),
  C("Copenhagen", ["copenhagen", "kopenhagen"], ["копенгаген"]),
  C("Stockholm", ["stockholm", "stokholm"], ["стокгольм"]),
  C("Oslo", ["oslo"], ["осло"]),
  C("Helsinki", ["helsinki"], ["хельсинк"]),
  C("Riga", ["riga"], ["риг"]),
  C("Vilnius", ["vilnius"], ["вильнюс"]),
  C("Tallinn", ["tallinn", "tallin"], ["таллин"]),
  C("Podgorica", ["podgorica", "podqoritsa"], ["подгориц"]),
  C("Tivat", ["tivat"], ["тиват"]),
  C("Larnaca", ["larnaca", "larnaka"], ["ларнак"]),
  C("Malta", ["malta"], ["мальт"]),
  C("New York", ["new york", "nyu-york", "nyu york", "newyork"], ["нью-йорк", "нью йорк"]),
  C("Los Angeles", ["los angeles", "los-anceles", "los anceles"], ["лос-анджелес"]),
  C("Miami", ["miami", "mayami"], ["майами"]),
  C("Toronto", ["toronto"], ["торонто"]),
  C(
    "Shanghai",
    ["shanghai", "şanxay", "sanxay", "shanxay", "sanghay", "sangay", "şanghay"],
    ["шанха"],
  ),
  C("Beijing", ["beijing", "pekin", "peking", "beycin"], ["пекин"]),
  C("Guangzhou", ["guangzhou", "quançjou", "kanton"], ["гуанчжоу"]),
  C("Hong Kong", ["hong kong", "honkonq", "honkong", "hong-kong"], ["гонконг"]),
  C("Urumqi", ["urumqi", "urumçi", "urumci"], ["урумчи"]),
  C("Tokyo", ["tokyo", "tokio"], ["токио"]),
  C("Osaka", ["osaka"], ["осак"]),
  C("Seoul", ["seoul", "seul"], ["сеул"]),
  C("Bangkok", ["bangkok", "banqkok"], ["бангкок"]),
  C("Phuket", ["phuket", "puket", "pxuket"], ["пхукет"]),
  C("Bali", ["bali"], ["бали"]),
  C("Kuala Lumpur", ["kuala lumpur", "kuala-lumpur"], ["куала-лумпур", "куала лумпур"]),
  C("Singapore", ["singapore", "sinqapur", "singapur"], ["сингапур"]),
  C("Delhi", ["delhi", "dehli", "nyu-dehli", "new delhi"], ["дели"]),
  C("Mumbai", ["mumbai", "mumbay"], ["мумба"]),
  C("Goa", ["goa"], ["гоа"]),
  C("Male", ["maldives", "maldiv", "maldivlər", "maldivler"], ["мальдив"]),
  C("Colombo", ["colombo", "kolombo", "sri lanka", "şri-lanka"], ["коломбо", "шри-ланк"]),
  C("Kathmandu", ["kathmandu", "katmandu"], ["катманду"]),
  C("Islamabad", ["islamabad", "islamabad"], ["исламабад"]),
  C("Lahore", ["lahore", "lahor"], ["лахор"]),
];

// Flat lookup tables, longest variant first so "abu dhabi" wins over "abu".
const LATIN: { v: string; en: string }[] = GAZETTEER.flatMap((c) =>
  [...c.latin, c.en].map((v) => ({ v: fold(v), en: c.en })),
)
  .filter((x, i, a) => a.findIndex((y) => y.v === x.v) === i)
  .sort((a, b) => b.v.length - a.v.length);
const CYR: { v: string; en: string }[] = GAZETTEER.flatMap((c) =>
  c.ru.map((v) => ({ v: v.toLowerCase(), en: c.en })),
).sort((a, b) => b.v.length - a.v.length);

/** Canonical English city name for a value ("Bakı", "Şanxay", "Шанхай", "Shanghai (PVG)"), or null. */
export function cityKey(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const f = fold(raw.replace(/\s*\([A-Z]{3}\)\s*$/, ""));
  for (const { v, en } of LATIN) if (f === v) return en;
  const lc = raw.toLowerCase();
  for (const { v, en } of CYR)
    if (lc === v || (lc.startsWith(v) && lc.length - v.length <= 3)) return en;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Route: origin and destination
// ---------------------------------------------------------------------------------------------
type Role = "from" | "to" | null;
interface Hit {
  en: string;
  start: number;
  role: Role;
}
// Azerbaijani / Turkish case endings (already folded: "dən" -> "den", "yə" -> "ye").
const ABLATIVE = new Set(["dan", "den", "tan", "ten", "ndan", "nden", "ydan", "yden"]);
const DATIVE = new Set(["a", "e", "ya", "ye", "na", "ne"]);
// Endings that keep the word a city name but say nothing about direction (in / of / city's).
const NEUTRAL = new Set([
  "",
  "da",
  "de",
  "ta",
  "te",
  "nin",
  "nun",
  "in",
  "un",
  "i",
  "u",
  "ya'",
  "lu",
  "li",
]);

const FROM_WORDS = /^(from|из|от|с|со)$/;
const TO_WORDS = /^(to|в|во|до|на|into|towards)$/;

/** Every city mention in the text, with the direction its grammar gives (if any). */
function cityHits(text: string): Hit[] {
  const hits: Hit[] = [];
  const f = fold(text);
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  const prevWord = (s: string, at: number) =>
    (s.slice(0, at).match(/([\p{L}]+)[^\p{L}]*$/u)?.[1] ?? "").toLowerCase();

  for (const { v, en } of LATIN) {
    const rx = new RegExp(`(?<![\\p{L}])${esc(v)}(?:['’]?([\\p{L}]*))`, "gu");
    for (const m of f.matchAll(rx)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (!free(start, end)) continue;
      const suffix = (m[1] ?? "").toLowerCase();
      let role: Role = null;
      if (ABLATIVE.has(suffix)) role = "from";
      else if (DATIVE.has(suffix)) role = "to";
      else if (!NEUTRAL.has(suffix)) continue; // "parisian", "romantic" -> not a city
      const pw = prevWord(f, start);
      if (!role && FROM_WORDS.test(pw)) role = "from";
      if (!role && TO_WORDS.test(pw)) role = "to";
      taken.push([start, end]);
      hits.push({ en, start, role });
    }
  }
  const lc = text.toLowerCase();
  for (const { v, en } of CYR) {
    const rx = new RegExp(`(?<![\\p{L}])${esc(v)}([\\p{L}]{0,3})(?![\\p{L}])`, "gu");
    for (const m of lc.matchAll(rx)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (!free(start, end)) continue;
      const pw = prevWord(lc, start);
      const role: Role = FROM_WORDS.test(pw) ? "from" : TO_WORDS.test(pw) ? "to" : null;
      taken.push([start, end]);
      hits.push({ en, start, role });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

export interface ParsedRoute {
  origin?: string;
  destination?: string;
}

/**
 * Origin / destination from one message.
 * "mene bakidan londona bilet lazimdi" -> Baku -> London; "Şanxaydan Bakıya" -> Shanghai -> Baku;
 * "from Shanghai to Baku", "из Шанхая в Баку", "Baku - London" (no grammar: first = origin).
 */
export function parseRoute(text: string): ParsedRoute {
  const hits = cityHits(text);
  if (!hits.length) return {};
  let origin = hits.find((h) => h.role === "from");
  let dest = hits.find((h) => h.role === "to" && h.en !== origin?.en);
  const unroled = hits.filter((h) => !h.role && h !== origin && h !== dest);
  // "X to Y": an unmarked city just before a destination is the origin; "X from Y" the other way round.
  if (!origin && dest) origin = unroled.find((h) => h.start < dest!.start && h.en !== dest!.en);
  if (origin && !dest) dest = unroled.find((h) => h.start > origin!.start && h.en !== origin!.en);
  // No grammar at all ("Baku London", "Baku - London"): reading order. A lone city without a direction
  // ("Milan" answering "from which city?") is left to the conversation, code does not guess its side.
  if (!origin && !dest) {
    const distinct = hits.filter((h, i, a) => a.findIndex((x) => x.en === h.en) === i);
    if (distinct.length >= 2) {
      origin = distinct[0];
      dest = distinct[1];
    }
  }
  const out: ParsedRoute = {};
  if (origin) out.origin = origin.en;
  if (dest && dest.en !== origin?.en) out.destination = dest.en;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------
// Month words. Full stems take case endings ("noyabrda", "martın", "ноября"); short forms ("nov", "mar")
// must stand alone so "marka" or "Mayami" are never read as a month.
const MONTHS: { full: string[]; abbr: string[]; ru: string[] }[] = [
  { full: ["yanvar", "january", "ocak"], abbr: ["jan"], ru: ["январ", "янв"] },
  { full: ["fevral", "february", "subat"], abbr: ["feb"], ru: ["феврал", "фев"] },
  { full: ["mart", "march"], abbr: ["mar"], ru: ["март", "мар"] },
  { full: ["aprel", "april", "nisan"], abbr: ["apr"], ru: ["апрел", "апр"] },
  { full: ["mayis", "may"], abbr: [], ru: ["мая", "май", "мае"] },
  { full: ["iyun", "june", "haziran"], abbr: ["jun"], ru: ["июн"] },
  { full: ["iyul", "july", "temmuz"], abbr: ["jul"], ru: ["июл"] },
  { full: ["avgust", "august", "agustos"], abbr: ["aug"], ru: ["август", "авг"] },
  { full: ["sentyabr", "september", "eylul"], abbr: ["sep", "sept"], ru: ["сентябр", "сен"] },
  { full: ["oktyabr", "october", "ekim"], abbr: ["oct"], ru: ["октябр", "окт"] },
  { full: ["noyabr", "november", "kasim"], abbr: ["nov"], ru: ["ноябр", "ноя"] },
  { full: ["dekabr", "december", "aralik"], abbr: ["dec"], ru: ["декабр", "дек"] },
];
// Azerbaijani / Turkish case endings after a month name (folded).
const MONTH_ENDINGS = new Set([
  "",
  "da",
  "de",
  "ta",
  "te",
  "in",
  "un",
  "nin",
  "nun",
  "a",
  "e",
  "ya",
  "ye",
  "dan",
  "den",
  "dek",
  "ayi",
  "ayinda",
]);
/**
 * Month number of a word ("noyabrda", "november", "ноября", "nov."), else 0.
 * strict = the word stands alone (no day number next to it): only real month forms count, and the
 * English "may" only when written "May".
 */
function monthOf(word: string, strict = false): number {
  const clean = word.replace(/\.$/, "");
  const w = fold(clean);
  if (w.length < 3) return 0;
  const lc = clean.toLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    const m = MONTHS[i]!;
    for (const stem of m.ru) {
      // Short Russian forms ("ноя", "мая") must be the whole word; longer stems take case endings.
      if (stem.length <= 3 ? lc === stem : lc.startsWith(stem) && lc.length - stem.length <= 3)
        return i + 1;
    }
    for (const stem of m.abbr) if (w === stem) return i + 1;
    for (const stem of m.full) {
      if (!w.startsWith(stem)) continue;
      const rest = w.slice(stem.length);
      if (
        stem === "may" &&
        strict &&
        !(clean.startsWith("May") || (rest && MONTH_ENDINGS.has(rest)))
      )
        continue;
      if (MONTH_ENDINGS.has(rest) || (!strict && rest.length <= 2)) return i + 1;
    }
  }
  return 0;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const addDays = (isoDate: string, n: number) =>
  new Date(Date.parse(isoDate + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (isoDate: string) => new Date(isoDate + "T00:00:00Z").getUTCDay(); // 0 = Sunday

/** Day + month without a year -> the next such date from today (this year or next). */
function upcoming(m: number, d: number, today: string, year?: number): string | null {
  if (year) return valid(year, m, d) ? iso(year, m, d) : null;
  const y = Number(today.slice(0, 4));
  for (const yy of [y, y + 1]) if (valid(yy, m, d) && iso(yy, m, d) >= today) return iso(yy, m, d);
  return null;
}
/** First day of the next occurrence of a month ("2027-03" when asked in Nov 2026). */
function upcomingMonth(m: number, today: string): string {
  const y = Number(today.slice(0, 4));
  const cur = Number(today.slice(5, 7));
  return `${m >= cur ? y : y + 1}-${pad(m)}`;
}

export interface ParsedDates {
  depart?: string;
  ret?: string;
  /** Month to open the calendar on when no exact day was given ("Novruz" -> March, "in May"). */
  month?: string;
  /** Days to highlight in the calendar (a holiday). */
  highlight?: [string, string];
  /** Name of the holiday that was mentioned, for the picker. */
  holiday?: string;
  /** The user wants any dates ("flexible", "fərqi yoxdur"). */
  flexible?: boolean;
  /** Trip type the user asked for, if they said it. */
  mode?: "round" | "oneway";
}

const ONE_WAY_RX =
  /\b(one[\s-]?way|bir\s?t[eə]r[eə]fli|bir\s?t[eə]r[eə]f[eə]?|t[eə]k\s?y[oö]n|tek\s?gidi[sş])\b|в одну сторону|в один конец/i;
const ROUND_RX =
  /\b(round[\s-]?trip|return\s+ticket|ged[iı][sş][\s-]+g[eə]l[iı][sş]|ged[iı][sş][\s-]+d[oö]n[uü][sş]|gidi[sş][\s-]+d[oö]n[uü][sş]|qay[ıi]d|gay[ıi]d|qay[ıi]t|gay[ıi]t|d[oö]n[uü][sş]|d[oö]n[uü]r[uü]m|geri\s+d[oö]n|come\s+back|coming\s+back|back\s+on|returning|return)\w*|туда[\s-]+(и\s+)?обратно|обратно|вернусь|возвращ\w*/i;
const FLEX_RX =
  /\b(flexible|any\s?time|anytime|whenever|any\s+dates?|cheapest\s+dates?|f[eə]rq[iı]\s+yoxdu\w*|f[eə]rq\s+etm[eə]z|ist[eə]nil[eə]n\s+vaxt|ist[eə]nil[eə]n\s+tarix|[eə]n\s+ucuz\s+tarix\w*|esnek|fark\s+etmez)\b|неважно|любые\s+даты|в\s+любое\s+время|без\s+разницы/i;

const HOLIDAYS: { rx: RegExp; name: string; month: number; from: number; to: number }[] = [
  // Novruz: official days off in Azerbaijan are around the March equinox (20-24 March).
  { rx: /novruz|nowruz|navruz|nevruz|новруз|навруз/i, name: "Novruz", month: 3, from: 20, to: 24 },
  {
    rx: /yeni\s+il|new\s+year|новый\s+год|новогодн|y[ıi]lba[sş][ıi]/i,
    name: "New Year",
    month: 12,
    from: 31,
    to: 31,
  },
];

/**
 * Exact dates (and hints) in a message or slot value, resolved against `today` (YYYY-MM-DD).
 * "3 noyabr gedirem 11 noyabr gayidiram" -> 2026-11-03 / 2026-11-11; "getmek 4noyabr gayitmaq 10 noyabr";
 * "3-11 noyabr", "с 3 по 11 ноября", "Nov 3 - Nov 11", "03.11-11.11", "2026-11-03/2026-11-11";
 * "Novruzda" -> month 2027-03 (no day: the user picks it); "flexible" -> flexible.
 */
export function parseDates(text: string, today: string): ParsedDates {
  const out: ParsedDates = {};
  const raw = (text ?? "").trim();
  if (!raw) return out;
  if (ONE_WAY_RX.test(raw)) out.mode = "oneway";
  else if (ROUND_RX.test(raw)) out.mode = "round";

  const found: { at: number; date: string }[] = [];
  const add = (at: number, date: string | null) => {
    if (date && !found.some((x) => x.date === date)) found.push({ at, date });
  };

  // 1) ISO dates.
  for (const m of raw.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))
    if (valid(+m[1]!, +m[2]!, +m[3]!)) add(m.index!, iso(+m[1]!, +m[2]!, +m[3]!));

  // 2) Day (+ optional range day) + month word: "3 noyabr", "4noyabr", "3-11 noyabr", "3-cü noyabr",
  //    "с 3 по 11 ноября", "3rd of November", "3 noyabrdan 11 noyabra".
  const dayMonth =
    /(?<![\d./-])(\d{1,2})(?:\s*(?:-?(?:ci|cı|cu|cü|nci|ncı|ncu|ncü|th|st|nd|rd|го|е|ое|ого)))?(?:\s*(?:-|–|—|\.\.|по|ilə|ile|until|to|till)\s*(\d{1,2})(?:\s*(?:-?(?:ci|cı|cu|cü|th|st|nd|rd|го|е)))?)?\s*(?:of\s+)?([\p{L}]{3,}\.?)(?:\s+(\d{4}))?/gu;
  for (const m of raw.matchAll(dayMonth)) {
    const mon = monthOf(m[3]!);
    if (!mon) continue;
    const year = m[4] ? Number(m[4]) : undefined;
    const d1 = Number(m[1]);
    const first = upcoming(mon, d1, today, year);
    add(m.index!, first);
    if (m[2]) {
      let second = upcoming(mon, Number(m[2]), today, year);
      if (first && second && second < first)
        second = upcoming(mon, Number(m[2]), addDays(first, 1));
      add(m.index! + 1, second);
    }
  }
  // 3) Month word + day: "November 3", "Nov 3rd - 11th", "noyabrın 3-ü".
  const monthDay =
    /(?<![\p{L}])([\p{L}]{3,}\.?)\s*(?:ın|in|un|ün|nın|nin)?\s+(\d{1,2})(?:st|nd|rd|th|-?(?:ü|u|i|ı|si|sı|su|sü))?(?:\s*(?:-|–|—|to|until|till)\s*(?:([\p{L}]{3,}\.?)\s+)?(\d{1,2})(?:st|nd|rd|th)?)?(?:,?\s+(\d{4}))?(?![\d:])/gu;
  for (const m of raw.matchAll(monthDay)) {
    const mon = monthOf(m[1]!);
    if (!mon) continue;
    const year = m[5] ? Number(m[5]) : undefined;
    const first = upcoming(mon, Number(m[2]), today, year);
    add(m.index!, first);
    if (m[4]) {
      const mon2 = m[3] ? monthOf(m[3]) || mon : mon;
      let second = upcoming(mon2, Number(m[4]), today, year);
      if (first && second && second < first)
        second = upcoming(mon2, Number(m[4]), addDays(first, 1));
      add(m.index! + 1, second);
    }
  }
  // 4) Numeric day.month(.year): "03.11", "3/11/2026", "03.11-11.11". Times like "19.00" are not dates.
  for (const m of raw.matchAll(/(?<![\d:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d:])/g)) {
    const d = Number(m[1]),
      mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    add(m.index!, upcoming(mo, d, today, y));
  }
  // 5) Relative words.
  const f = fold(raw);
  const thisWeekendFri = () => {
    const wd = weekday(today);
    if (wd === 6) return addDays(today, -1); // Saturday -> this Friday (trip already on)
    if (wd === 0) return addDays(today, 5); // Sunday -> next Friday
    return addDays(today, (5 - wd + 7) % 7);
  };
  if (
    /\b(next weekend|gelen hefte ?sonu)\b|следующ\w* выходн/u.test(f) ||
    /следующ\w* выходн/.test(raw.toLowerCase())
  ) {
    const fri = addDays(thisWeekendFri(), weekday(today) >= 4 || weekday(today) === 0 ? 7 : 0);
    add(0, fri);
    add(1, addDays(fri, 2));
  } else if (
    /\b(this weekend|bu hefte ?sonu|hefte ?sonu|weekend)\b/.test(f) ||
    /(эти|на) выходн/.test(raw.toLowerCase())
  ) {
    const fri = thisWeekendFri();
    add(0, fri);
    add(1, addDays(fri, 2));
  }
  if (!found.length) {
    if (/\b(tomorrow|yarin)\b/.test(f) || /\bзавтра\b/.test(raw.toLowerCase()))
      add(0, addDays(today, 1));
    else if (/\b(today|bu ?gun)\b/.test(f) || /\bсегодня\b/.test(raw.toLowerCase())) add(0, today);
  }

  if (found.length) {
    const dates = [...new Set(found.map((x) => x.date))].sort();
    out.depart = dates[0]!;
    if (dates.length > 1 && out.mode !== "oneway") out.ret = dates[dates.length - 1]!;
    return out;
  }

  // No exact day. Holidays and month names give the calendar a starting month.
  for (const h of HOLIDAYS) {
    if (!h.rx.test(raw)) continue;
    out.month = upcomingMonth(h.month, today);
    const y = Number(out.month.slice(0, 4));
    out.highlight = [iso(y, h.month, h.from), iso(y, h.month, h.to)];
    out.holiday = h.name;
    return out;
  }
  for (const w of raw.split(/[^\p{L}.]+/u)) {
    const mon = monthOf(w, true);
    if (mon) {
      out.month = upcomingMonth(mon, today);
      return out;
    }
  }
  if (
    /\b(next month|gelen ay)\b/.test(f) ||
    /в следующем месяце|в след\w* месяц/.test(raw.toLowerCase())
  ) {
    const y = Number(today.slice(0, 4)),
      m = Number(today.slice(5, 7));
    out.month = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
    return out;
  }
  if (FLEX_RX.test(raw)) out.flexible = true;
  return out;
}

const OTHER_DATES_RX =
  /\b(different|other|another|new|change|changing|later|earlier)\s+(the\s+)?(dates?|days?)\b|\bchange\s+(the\s+|my\s+)?(dates?|days?)\b|\b(ba[sş]qa|f[eə]rqli|dig[eə]r|yeni|ba[sş]ka|farkl[ıi])\s+(bir\s+)?(tarix|tarih|g[uü]n)\p{L}*|\btarix\p{L}*\s+(d[eə]yi[sş]|d[eə]yis)\p{L}*|\btarih\p{L}*\s+de[gğ]i[sş]\p{L}*|друг\p{L}*\s+(дат|дн|числ)\p{L}*|(помен|измен|смен|перенес)\p{L}*\s+(дат|дн)\p{L}*/iu;
/** "I want different dates", "başqa tarix", "tarixi dəyiş", "другие даты": pick new dates in the calendar. */
export const wantsOtherDates = (text: string) => OTHER_DATES_RX.test(text);

/** "2026-11-03/2026-11-11" or "2026-11-03" -> parts; anything else -> null. */
export function isoDatesOf(v: string | null | undefined): { depart: string; ret: string } | null {
  const m = (v ?? "")
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})(?:\s*(?:\/|to|–|-{1,2}|\s)\s*(\d{4}-\d{2}-\d{2}))?$/);
  return m ? { depart: m[1]!, ret: m[2] ?? "" } : null;
}

/** "2 nəfər", "for 2 people", "2 adults", "на двоих" -> 2. */
export function parseTravelers(text: string): number | null {
  const f = fold(text);
  const m =
    f.match(
      /\b(\d)\s*(?:-?\s*)(nefer\w*|neferlik|people|persons?|pax|passengers?|adults?|kisi\w*|yetiskin\w*)\b/,
    ) ?? text.toLowerCase().match(/(\d)\s*(?:человек\w*|пассажир\w*|взросл\w*)/);
  if (m) return Number(m[1]);
  const words: Record<string, number> = {
    iki: 2,
    uc: 3,
    dord: 4,
    bes: 5,
    two: 2,
    three: 3,
    four: 4,
  };
  const w = f.match(
    /\b(iki|uc|dord|bes|two|three|four)\s+(nefer\w*|people|persons|adults|kisi\w*)\b/,
  );
  if (w) return words[w[1]!] ?? null;
  if (/на двоих|вдвоем|вдвоём/.test(text.toLowerCase())) return 2;
  return null;
}

/** Date-picker hint sent to the app: "m=2027-03;mode=round;hl=2027-03-20..2027-03-24;name=Novruz;from=..." */
export interface DateHint {
  month?: string;
  mode?: "round" | "oneway";
  highlight?: [string, string];
  holiday?: string;
  from?: string;
}
export function encodeDateHint(h: DateHint): string {
  return [
    h.month ? `m=${h.month}` : "",
    h.mode ? `mode=${h.mode}` : "",
    h.highlight ? `hl=${h.highlight[0]}..${h.highlight[1]}` : "",
    h.holiday ? `name=${h.holiday}` : "",
    h.from ? `from=${h.from}` : "",
  ]
    .filter(Boolean)
    .join(";");
}
