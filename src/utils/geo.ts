const REGIONAL_INDICATOR_MIN = 0x1f1e6;
const REGIONAL_INDICATOR_MAX = 0x1f1ff;
const ASCII_ALPHA_START = 0x41;
const FLAG_EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
const ISO_CODE_RE = /\b[A-Z]{2}\b/g;

// ISO-3166-1 alpha-2(外加 UI 当成国旗渲染的少数伪代码),用来在接受一个宽松的双字母 token 前校验它,
// 这样像 "GO Cloud" 或 "MY Server"→"GO"/"MY" 这类自由文本只有在 token 是真实代码时才会解析。
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
  // 用无空格的 key 就够:getCountryCodeFromRegion 会去掉所有空白再查一次,所以带空格的变体
  // ("united kingdom" 等)无需单独加条目也能命中这里。
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

export function getCountryCodeFromRegion(region: string | null | undefined): string | null {
  const raw = region?.trim();
  if (!raw) return null;

  const emoji = raw.match(FLAG_EMOJI_RE)?.[0];
  if (emoji) return countryCodeFromFlagEmoji(emoji);

  // 命名地区(如 "China"、"中国"、"DE Frankfurt"→"de frankfurt")先于宽松 ISO 正则解析,免得像
  // "OK Cloud" 里 "OK" 这种乱入的双字母 token 盖掉真正的别名匹配。
  const normalized = raw
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliased = REGION_ALIASES[normalized] ?? REGION_ALIASES[normalized.replace(/\s+/g, "")];
  if (aliased) return aliased;

  const upper = raw.toUpperCase();
  // "UK" 是 GB 常见的非 ISO 同义写法。
  const resolveToken = (token: string) => (token === "UK" ? "GB" : token);
  const isValidToken = (token: string) =>
    token === "UK" || ISO_3166_ALPHA2.has(token);

  // 优先匹配整串的 ISO 代码;只有像 "DE Frankfurt" 这种代码嵌在自由文本里的输入才退而用 token 匹配。
  // 两条路径都必须是真实代码,免得乱入的词("GO Cloud")解析出假国旗。
  const whole = upper.match(/^[A-Z]{2}$/)?.[0];
  if (whole && isValidToken(whole)) return resolveToken(whole);

  for (const match of upper.matchAll(ISO_CODE_RE)) {
    const token = match[0];
    if (isValidToken(token)) return resolveToken(token);
  }

  return null;
}

export function getDisplayRegionCode(region: string | null | undefined) {
  return getCountryCodeFromRegion(region) ?? "UN";
}
