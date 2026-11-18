const REGIONAL_INDICATOR_MIN = 0x1f1e6;
const REGIONAL_INDICATOR_MAX = 0x1f1ff;
const ASCII_ALPHA_START = 0x41;
const FLAG_EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
const ISO_CODE_RE = /\b[A-Z]{2}\b/g;

const ISO_3166_ALPHA2 = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET EU FI FJ FK FM " +
    "FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT " +
    "JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN " +
    "MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT " +
    "PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL " +
    "TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

const REGION_ALIASES: Record<string, string> = {
  argentina: "AR",
  america: "US",
  australia: "AU",
  austria: "AT",
  belgium: "BE",
  brazil: "BR",
  britain: "GB",
  canada: "CA",
  chile: "CL",
  china: "CN",
  cn: "CN",
  denmark: "DK",
  de: "DE",
  deutschland: "DE",
  europa: "EU",
  europe: "EU",
  france: "FR",
  germany: "DE",
  hk: "HK",
  hongkong: "HK",
  "hong kong": "HK",
  india: "IN",
  indonesia: "ID",
  ireland: "IE",
  israel: "IL",
  italy: "IT",
  japan: "JP",
  korea: "KR",
  malaysia: "MY",
  mexico: "MX",
  netherlands: "NL",
  norway: "NO",
  philippines: "PH",
  poland: "PL",
  portugal: "PT",
  russia: "RU",
  singapore: "SG",
  spain: "ES",
  sweden: "SE",
  switzerland: "CH",
  taiwan: "TW",
  thailand: "TH",
  turkey: "TR",
  uk: "GB",
  uae: "AE",
  "united arab emirates": "AE",
  unitedkingdom: "GB",
  unitedstates: "US",
  us: "US",
  usa: "US",
  vietnam: "VN",
  阿根廷: "AR",
  奥地利: "AT",
  奧地利: "AT",
  比利时: "BE",
  比利時: "BE",
  巴西: "BR",
  中国: "CN",
  中國: "CN",
  台湾: "TW",
  台灣: "TW",
  香港: "HK",
  澳门: "MO",
  澳門: "MO",
  日本: "JP",
  韩国: "KR",
  韓國: "KR",
  新加坡: "SG",
  印度: "IN",
  印尼: "ID",
  印度尼西亚: "ID",
  印度尼西亞: "ID",
  马来西亚: "MY",
  馬來西亞: "MY",
  美国: "US",
  美國: "US",
  英国: "GB",
  英國: "GB",
  德国: "DE",
  德國: "DE",
  法国: "FR",
  法國: "FR",
  加拿大: "CA",
  澳大利亚: "AU",
  澳大利亞: "AU",
  澳洲: "AU",
  荷兰: "NL",
  荷蘭: "NL",
  爱尔兰: "IE",
  愛爾蘭: "IE",
  意大利: "IT",
  西班牙: "ES",
  葡萄牙: "PT",
  瑞典: "SE",
  瑞士: "CH",
  挪威: "NO",
  丹麦: "DK",
  丹麥: "DK",
  波兰: "PL",
  波蘭: "PL",
  俄罗斯: "RU",
  俄羅斯: "RU",
  土耳其: "TR",
  泰国: "TH",
  泰國: "TH",
  越南: "VN",
  菲律宾: "PH",
  菲律賓: "PH",
  墨西哥: "MX",
  智利: "CL",
  以色列: "IL",
  阿联酋: "AE",
  阿聯酋: "AE",
  欧洲: "EU",
  歐洲: "EU",
};

function countryCodeFromFlagEmoji(input: string): string | null {
  const chars = Array.from(input);
  if (chars.length !== 2) return null;

  const first = chars[0].codePointAt(0) ?? 0;
  const second = chars[1].codePointAt(0) ?? 0;
  const valid =
    first >= REGIONAL_INDICATOR_MIN &&
    first <= REGIONAL_INDICATOR_MAX &&
    second >= REGIONAL_INDICATOR_MIN &&
    second <= REGIONAL_INDICATOR_MAX;

  if (!valid) return null;

  return String.fromCodePoint(
    first - REGIONAL_INDICATOR_MIN + ASCII_ALPHA_START,
    second - REGIONAL_INDICATOR_MIN + ASCII_ALPHA_START,
  );
}

const REGION_CODE_CACHE_LIMIT = 512;
const regionCodeCache = new Map<string, string | null>();

export function getCountryCodeFromRegion(region: string | null | undefined): string | null {
  const raw = region?.trim();
  if (!raw) return null;

  const cached = regionCodeCache.get(raw);
  if (cached !== undefined) return cached;

  const resolved = resolveCountryCodeFromRegion(raw);
  if (regionCodeCache.size >= REGION_CODE_CACHE_LIMIT) regionCodeCache.clear();
  regionCodeCache.set(raw, resolved);
  return resolved;
}

function resolveCountryCodeFromRegion(raw: string): string | null {
  const emoji = raw.match(FLAG_EMOJI_RE)?.[0];
  if (emoji) return countryCodeFromFlagEmoji(emoji);

  const normalized = raw
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliased = REGION_ALIASES[normalized] ?? REGION_ALIASES[normalized.replace(/\s+/g, "")];
  if (aliased) return aliased;

  const upper = raw.toUpperCase();
  const resolveToken = (token: string) => (token === "UK" ? "GB" : token);
  const isValidToken = (token: string) =>
    token === "UK" || ISO_3166_ALPHA2.has(token);

  const whole = upper.match(/^[A-Z]{2}$/)?.[0];
  if (whole && isValidToken(whole)) return resolveToken(whole);

  for (const match of raw.matchAll(ISO_CODE_RE)) {
    const token = match[0];
    if (isValidToken(token)) return resolveToken(token);
  }

  return null;
}

export function getDisplayRegionCode(region: string | null | undefined) {
  return getCountryCodeFromRegion(region) ?? "UN";
}
