const SIZE_TOKEN = /\b\d+(?:[.,]\d+)?\s*(?:kg|kgs|g|gm|gms|gram|grams|ml|l|lt|ltr|litre|litres|liter|liters|pcs?|pieces?|packets?|pouches?|bottles?|boxes?|count|nos?)\b/giu;
const COMMON_ENGLISH_MEANINGS: Record<string, string> = {
  "চা": "tea", "চা পাতা": "tea leaves", "দুধ": "milk", "চিনি": "sugar", "চাল": "rice", "আটা": "flour", "ময়দা": "flour", "ময়দা": "flour", "বিস্কুট": "biscuits", "নুডলস": "noodles", "ম্যাগি": "maggi noodles", "সাবান": "soap", "তেল": "oil", "লবণ": "salt", "পাউরুটি": "bread", "ডিম": "eggs", "পানি": "water", "জল": "water",
  "चाय": "tea", "दूध": "milk", "चीनी": "sugar", "चावल": "rice", "आटा": "flour", "मैदा": "flour", "बिस्कुट": "biscuits", "नूडल्स": "noodles", "मैगी": "maggi noodles", "साबुन": "soap", "तेल": "oil", "नमक": "salt", "ब्रेड": "bread", "अंडे": "eggs", "पानी": "water",
  "حليب": "milk", "لبن": "milk", "شاي": "tea", "سكر": "sugar", "أرز": "rice", "ارز": "rice", "دقيق": "flour", "بسكويت": "biscuits", "معكرونة": "noodles", "زيت": "oil", "ملح": "salt", "صابون": "soap", "خبز": "bread", "بيض": "eggs", "ماء": "water",
  "牛奶": "milk", "茶": "tea", "糖": "sugar", "大米": "rice", "面粉": "flour", "饼干": "biscuits", "方便面": "instant noodles", "肥皂": "soap", "食用油": "cooking oil", "盐": "salt", "面包": "bread", "鸡蛋": "eggs", "水": "water",
  "牛乳": "milk", "砂糖": "sugar", "米": "rice", "小麦粉": "flour", "ビスケット": "biscuits", "石鹸": "soap", "食塩": "salt", "パン": "bread", "卵": "eggs", "みず": "water", "ミルク": "milk",
  lait: "milk", leche: "milk", leite: "milk", "thé": "tea", "té": "tea", chá: "tea", sucre: "sugar", "azúcar": "sugar", acucar: "sugar", "açúcar": "sugar", arroz: "rice", riz: "rice", harina: "flour", farine: "flour", farinha: "flour", galletas: "biscuits", biscuits: "biscuits", biscoitos: "biscuits", savon: "soap", "jabón": "soap", sabão: "soap", aceite: "oil", huile: "oil", "óleo": "oil", pain: "bread", "pão": "bread", agua: "water", "água": "water", eau: "water",
  chai: "tea", cha: "tea", doodh: "milk", chini: "sugar", chawal: "rice", atta: "flour", maida: "flour", namak: "salt", tel: "oil", sabun: "soap", anda: "egg", ande: "eggs",
};

const ENGLISH_SYNONYMS: Record<string, string[]> = {
  noodles: ["instant noodles", "2 minute noodles", "noodle packet"],
  noodle: ["instant noodles", "2 minute noodles", "noodle packet"],
  biscuit: ["biscuits", "cookies", "tea biscuits"],
  biscuits: ["biscuit", "cookies", "tea biscuits"],
  milk: ["dairy milk", "milk pouch", "milk packet"],
  tea: ["tea leaves", "black tea", "tea powder"],
  sugar: ["white sugar", "granulated sugar", "table sugar"],
  rice: ["rice grain", "uncooked rice", "rice packet"],
  flour: ["wheat flour", "all purpose flour", "flour packet"],
  oil: ["cooking oil", "edible oil", "vegetable oil"],
  salt: ["table salt", "iodized salt", "cooking salt"],
  soap: ["bath soap", "soap bar", "bathing soap"],
  detergent: ["laundry detergent", "washing powder", "washing detergent"],
  chips: ["potato chips", "crisps", "snack chips"],
  cola: ["coke", "cola drink", "soft drink"],
  coke: ["cola", "cola drink", "soft drink"],
  chocolate: ["chocolate bar", "cocoa bar", "choco bar"],
  bread: ["bread loaf", "loaf bread", "sandwich bread"],
  water: ["drinking water", "bottled water", "water bottle"],
  egg: ["eggs", "chicken eggs", "egg pack"],
  eggs: ["egg", "chicken eggs", "egg pack"],
  coffee: ["coffee powder", "instant coffee", "ground coffee"],
};

function aliasKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

const normalizedMeanings = new Map(Object.entries(COMMON_ENGLISH_MEANINGS).map(([source, target]) => [aliasKey(source), target]));
const meaningPhrases = [...normalizedMeanings.keys()]
  .map((phrase) => ({ phrase, tokenCount: phrase.split(/\s+/u).length }))
  .sort((left, right) => right.tokenCount - left.tokenCount);

function cleanEnglish(value: string): string | null {
  const decomposed = value.normalize("NFKD").replace(/\p{M}/gu, "");
  const letters = Array.from(decomposed).filter((character) => /\p{L}/u.test(character));
  if (!letters.length || letters.some((character) => !/\p{Script=Latin}/u.test(character))) return null;
  const cleaned = decomposed.replace(/[^a-zA-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length >= 2 && cleaned.length <= 80 ? cleaned : null;
}

function translateCjkToken(token: string): string[] {
  const characters = Array.from(token);
  const translated: string[] = [];
  for (let index = 0; index < characters.length;) {
    const phrase = meaningPhrases.find(({ phrase: candidate }) => !candidate.includes(" ") && characters.slice(index, index + Array.from(candidate).length).join("") === candidate);
    if (phrase) {
      translated.push(normalizedMeanings.get(phrase.phrase)!);
      index += Array.from(phrase.phrase).length;
      continue;
    }
    const character = characters[index];
    if (/^[a-z0-9]$/iu.test(character)) {
      let end = index + 1;
      while (end < characters.length && /^[a-z0-9]$/iu.test(characters[end])) end += 1;
      const fragment = characters.slice(index, end).join("");
      if (cleanEnglish(fragment)) translated.push(fragment);
      index = end;
      continue;
    }
    index += 1;
  }
  return translated;
}

/** Deterministic fallback only; hosted/local LLM translation is used first when configured. */
export function translateProductReferenceToEnglish(value: string): string {
  const tokens = aliasKey(value).split(/\s+/u).filter(Boolean);
  if (!tokens.length) return "";
  const translated: string[] = [];
  for (let index = 0; index < tokens.length;) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(tokens[index])) {
      translated.push(...translateCjkToken(tokens[index]));
      index += 1;
      continue;
    }
    let matched = false;
    for (const candidate of meaningPhrases) {
      const phraseTokens = candidate.phrase.split(/\s+/u);
      if (phraseTokens.length > tokens.length - index) continue;
      if (phraseTokens.every((token, offset) => tokens[index + offset] === token)) {
        translated.push(candidate.phrase ? normalizedMeanings.get(candidate.phrase)! : candidate.phrase);
        index += phraseTokens.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const token = tokens[index];
    const latin = cleanEnglish(token);
    if (latin) translated.push(latin);
    else if (/^\d+(?:[.,]\d+)?$/u.test(token)) translated.push(token);
    index += 1;
  }
  return translated.join(" ").replace(/\s+/g, " ").trim();
}

function cleanProductNameAsEnglish(name: string): string | null {
  const normalized = translateProductReferenceToEnglish(name);
  return cleanEnglish(normalized);
}

function sizeFree(value: string): string {
  return value.replace(SIZE_TOKEN, " ").replace(/\s+/g, " ").trim();
}

function englishFallbackCandidates(base: string, category: string, unit: string): string[] {
  const candidates: string[] = [];
  const sizedFree = sizeFree(base);
  if (sizedFree) candidates.push(sizedFree);
  const words = sizedFree.split(/\s+/u).filter(Boolean);
  if (words.length > 1) {
    candidates.push(words.slice(0, -1).join(" "));
    candidates.push(words.slice(1).join(" "));
  }
  const tokens = words.map((word) => word.toLocaleLowerCase());
  for (const token of tokens) candidates.push(...(ENGLISH_SYNONYMS[token] ?? []));
  const last = tokens.at(-1);
  if (last && last.length > 3) {
    if (last.endsWith("ies")) candidates.push(`${words.at(-1)?.slice(0, -3)}y`);
    else if (last.endsWith("ves")) candidates.push(`${words.at(-1)?.slice(0, -3)}f`);
    else if (last.endsWith("s") && !last.endsWith("ss")) candidates.push(words.at(-1)!.slice(0, -1));
    else candidates.push(`${words.at(-1)}s`);
  }
  const cleanCategory = cleanEnglish(category);
  if (cleanCategory && !/^general$/i.test(cleanCategory)) {
    candidates.push(`${sizedFree} ${cleanCategory}`, `${cleanCategory} ${sizedFree}`);
  }
  const cleanUnit = cleanEnglish(unit);
  if (cleanUnit && !aliasKey(sizedFree).includes(aliasKey(cleanUnit))) candidates.push(`${sizedFree} ${cleanUnit}`);
  candidates.push(`${sizedFree} item`, `${sizedFree} product`, `${sizedFree} goods`);
  return candidates;
}

/** Returns four or five distinct English search aliases, excluding the canonical product name. */
export function buildEnglishProductAliases(
  name: string,
  proposedAliases: string[] = [],
  category = "General",
  unit = "unit",
): string[] {
  const englishName = cleanProductNameAsEnglish(name);
  const normalizedProposals = proposedAliases.map((alias) => cleanProductNameAsEnglish(alias)).filter((alias): alias is string => Boolean(alias));
  const base = englishName ?? normalizedProposals[0];
  const canonicalKey = aliasKey(name);
  const result: string[] = [];
  const seen = new Set<string>(canonicalKey ? [canonicalKey] : []);

  const add = (value: string | null | undefined) => {
    if (!value) return;
    const cleaned = cleanEnglish(value);
    if (!cleaned) return;
    const key = aliasKey(cleaned);
    if (key.length < 2 || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned.toLocaleLowerCase());
  };

  for (const alias of normalizedProposals) add(alias);
  if (englishName && aliasKey(englishName) !== aliasKey(name)) add(englishName);
  if (base) {
    for (const candidate of englishFallbackCandidates(base, category, unit)) add(candidate);
  } else {
    for (const fallback of ["shop item", "store product", "retail goods", "inventory item"]) add(fallback);
  }
  return result.slice(0, 5);
}

export function isEnglishProductSearchText(value: string): boolean {
  return cleanEnglish(value) !== null;
}
