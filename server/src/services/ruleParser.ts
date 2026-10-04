import type { Product } from "../types.js";
import type { ParsedIntent } from "./intentSchemas.js";
import { detectLanguage, localizedMessage, type ConversationLanguage } from "./conversationLocale.js";
import { isEnglishProductSearchText, translateProductReferenceToEnglish } from "./productAliases.js";

const smallNumbers: Record<string, number> = {
  zero: 0, oh: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, soixanteix: 70, quatrevingt: 80, quatrevingts: 80, quatrevingtdix: 90,
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, "dieciséis": 16, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  um: 1, uma: 1, dois: 2, duas: 2, três: 3, quatro: 4, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, treze: 13, "dezesseis": 16, dezasseis: 16, dezessete: 17, dezassete: 17, dezoito: 18, dezenove: 19, vinte: 20, quarenta: 40, cinquenta: 50, sessenta: 60, oitenta: 80,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, aat: 8, nau: 9, das: 10,
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5, "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10, "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15, "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20,
  "এক": 1, "দুই": 2, "তিন": 3, "চার": 4, "পাঁচ": 5, "ছয়": 6, "ছয়": 6, "সাত": 7, "আট": 8, "নয়": 9, "নয়": 9, "দশ": 10, "এগারো": 11, "বারো": 12, "তেরো": 13, "চৌদ্দ": 14, "পনেরো": 15, "ষোলো": 16, "সতেরো": 17, "আঠারো": 18, "উনিশ": 19, "বিশ": 20,
  "صفر": 0, "واحد": 1, "واحدة": 1, "اثنان": 2, "اثنين": 2, "اثنتان": 2, "اثنتين": 2, "ثلاثة": 3, "ثلاث": 3, "أربعة": 4, "أربع": 4, "خمسة": 5, "خمس": 5, "ستة": 6, "ست": 6, "سبعة": 7, "سبع": 7, "ثمانية": 8, "ثمان": 8, "تسعة": 9, "تسع": 9, "عشرة": 10, "عشر": 10, "عشرين": 20,
};

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

function readNumberWords(words: string[]): { value: number; count: number } | null {
  if (!words.length) return null;
  let total = 0;
  let current = 0;
  let consumed = 0;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index].toLocaleLowerCase();
    if (["and", "et", "y", "e"].includes(word) && consumed > 0) {
      consumed += 1;
      continue;
    }
    if (/^\d+(?:\.\d+)?$/.test(word)) {
      if (consumed > 0) break;
      return { value: Number(word), count: 1 };
    }
    if (Object.hasOwn(smallNumbers, word)) {
      const number = smallNumbers[word];
      if (number >= 20 && number % 10 === 0) current += number;
      else current += number;
      consumed += 1;
      continue;
    }
    if (["hundred", "cent", "cien", "ciento", "cem", "cento", "مئة", "مائة"].includes(word)) {
      current = Math.max(current, 1) * 100;
      consumed += 1;
      continue;
    }
    if (["thousand", "mille", "mil", "ألف", "آلاف"].includes(word)) {
      total += Math.max(current, 1) * 1000;
      current = 0;
      consumed += 1;
      continue;
    }
    break;
  }
  if (!consumed) return null;
  return { value: total + current, count: consumed };
}

function readChineseNumber(value: string): number | null {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let section = 0;
  let current = 0;
  for (const character of value) {
    if (Object.hasOwn(digits, character)) {
      current = digits[character];
      continue;
    }
    if (!Object.hasOwn(units, character)) return null;
    const unit = units[character];
    section += Math.max(current, 1) * unit;
    current = 0;
    if (unit === 1000) { total += section; section = 0; }
  }
  return total + section + current;
}

function extractNumbers(text: string): number[] {
  const bengaliDigits: Record<string, string> = { "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9" };
  const devanagariDigits: Record<string, string> = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };
  const arabicIndicDigits: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
  const normalizedDigits = text.replace(/[০-৯]/g, (digit) => bengaliDigits[digit]).replace(/[०-९]/g, (digit) => devanagariDigits[digit]).replace(/[٠-٩]/g, (digit) => arabicIndicDigits[digit]);
  const rawTokens = normalizedDigits.toLocaleLowerCase().match(/\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千]+|[\p{L}\p{M}]+/gu) ?? [];
  const tokens = rawTokens.flatMap((token) => {
    if (Object.hasOwn(smallNumbers, token)) return [token];
    const attachedUnit = token.match(/^([\p{L}\p{M}]+?)(?:টি|টা|খানা|জন|প্যাকেট|পিস|पैकेट|पीस|यूनिट|बोतल|علبة|أكياس)$/u);
    return attachedUnit && Object.hasOwn(smallNumbers, attachedUnit[1]) ? [attachedUnit[1]] : [token];
  });
  const numbers: number[] = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (/^\d+(?:\.\d+)?$/.test(token)) {
      numbers.push(Number(token));
      index += 1;
      continue;
    }
    if (/^[零〇一二两三四五六七八九十百千]+$/u.test(token)) {
      const chineseNumber = readChineseNumber(token);
      if (chineseNumber !== null) { numbers.push(chineseNumber); index += 1; continue; }
    }
    if (Object.hasOwn(smallNumbers, token)) {
      const parsed = readNumberWords(tokens.slice(index));
      if (parsed) {
        numbers.push(parsed.value);
        index += Math.max(parsed.count, 1);
        continue;
      }
    }
    index += 1;
  }
  return numbers;
}

interface ProductHit { product: Product; alias: string; index: number }

function productHits(chunk: string, products: Product[]): ProductHit[] {
  const normalizedChunks = [...new Set([chunk, translateProductReferenceToEnglish(chunk)].map((value) => ` ${normalize(value)} `).filter((value) => value.trim()))];
  const hits: ProductHit[] = [];
  for (const product of products) {
    const aliases = [...new Set([product.name, ...product.aliases].filter(isEnglishProductSearchText))].sort((a, b) => b.length - a.length);
    const matchingAlias = aliases.find((alias) => {
      const normalizedAlias = normalize(alias);
      return normalizedAlias && normalizedChunks.some((normalizedChunk) => normalizedChunk.includes(` ${normalizedAlias} `));
    });
    if (matchingAlias) {
      const normalizedAlias = ` ${normalize(matchingAlias)} `;
      const index = Math.min(...normalizedChunks.map((normalizedChunk) => normalizedChunk.indexOf(normalizedAlias)).filter((value) => value >= 0));
      hits.push({ product, alias: matchingAlias, index });
    }
  }
  const specificHits = hits.filter((hit) => !["biscuit", "biscuits"].includes(normalize(hit.alias)));
  const preferred = specificHits.length ? specificHits : hits;
  return preferred.sort((a, b) => normalize(b.alias).length - normalize(a.alias).length);
}

function splitItemChunks(text: string): string[] {
  return text
    .replace(/\s+(?:and|&|plus|এবং|আর)\s+(?=(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|ek|do|teen|char|chaar|paanch|panch|এক|দুই|তিন|চার|পাঁচ|ছয়|ছয়|সাত|আট|নয়|নয়|দশ)(?![\p{L}\p{M}\p{N}]))/giu, " | ")
    .split(/[|,;]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function detectPeriod(text: string, defaultPeriod: "today" | "all" = "today"): "today" | "yesterday" | "week" | "last_week" | "month" | "last_month" | "all" {
  if (/\b(yesterday|hier|ayer|ontem)\b|গতকাল|أمس|昨天/u.test(text)) return "yesterday";
  if (/\b(last week|previous week|la semaine dernière|semana pasada|semana passada)\b|গত\s+সপ্তাহ|গত\s+সপ্তাহে|पिछले सप्ताह|الأسبوع الماضي|上周/u.test(text)) return "last_week";
  if (/\b(last month|previous month|mois dernier|mes pasado|mês passado)\b|গত\s+মাস|গত\s+মাসে|पिछले महीने|الشهر الماضي|上个月/u.test(text)) return "last_month";
  if (/\b(this week|weekly|week|cette semaine|esta semana|esta semana)\b|(?:এই\s+)?সপ্তাহ|इस सप्ताह|এই সপ্তাহ|هذا الأسبوع|本周/u.test(text)) return "week";
  if (/\b(this month|monthly|month|ce mois|este mes|este mês)\b|(?:এই\s+)?মাস|इस महीने|هذا الشهر|本月/u.test(text)) return "month";
  if (/\b(all time|ever|overall|all records|tous|histórico completo|historial completo)\b|সব সময়|সর্বমোট|अब तक|كل الوقت|全部时间/u.test(text)) return "all";
  if (/\b(today|aujourd'hui|hoy|hoje)\b|আজ|आज|اليوم|今天/u.test(text)) return "today";
  return defaultPeriod;
}

function hasQueryMarker(text: string): boolean {
  return /\b(how much|how many|total|show|what|tell me|summary|report|history|historical|list|records?|transactions?|count|number|which|top|best|most|purchase history|sales history|restock history|current stock|stock movement|inventory of|price of)\b|(?:কত|দেখাও|মোট|ইতিহাস|তালিকা|লেনদেন|কয়টি|কতগুলো|কতটা|कितना|कितने|कितनी|कुल|दिखाओ|इतिहास|लेनदेन|combien|historique|transactions|montant|cuánto|cuanto|historial|transacciones|quantas|quantos|quanto|histórico|transações|كم|ما قيمة|أظهر|عدد المعاملات|سجل|معاملات|多少|查询|显示|交易总数|历史|记录)/iu.test(text);
}

function transactionTypeIn(text: string): "all" | "sale" | "purchase" | "expense" | "loss" {
  if (/\b(loss|losses|damage|damaged|spoiled|waste|wastage|expired|lost)\b|(?:perdí|perdió|perdi|perdeu|perdu|perdue|pérdida|pérdidas|perte|pertes|perda|perdas|损耗|亏损|خسائر|ضرر|فقد|تلف|نষ্ট|ক্ষতি|नुकसान|नष्ट)/iu.test(text)) return "loss";
  if (/\b(expense|expenses|spend|spent|costs?|gasto|gastos)\b|(?:gasté|gastó|gastei|gastou|dépense|dépenses|despesa|despesas|مصروفات|مصروف|费用|开支|খরচ|ব্যয়|व्यय)/iu.test(text)) return "expense";
  if (/\b(purchase|purchases|bought|buy|restock|restocked|supplier)\b|(?:compré|compró|comprei|comprou|acheté|achats?|কেনা|কিনেছি|কিনলাম|खरीद|مشتريات|采购|进货|买了)/iu.test(text)) return "purchase";
  if (/\b(sale|sales|sold|sell|revenue)\b|(?:vendí|vendió|vendi|vendeu|vendu|ventes?|ventas?|vendas?|বিক্রি|বেচা|बिक्री|बेचा|बेची|बेचे|بعت|مبيعات|销售|卖了|售出)/iu.test(text)) return "sale";
  return "all";
}

function periodMentioned(text: string): boolean {
  return /\b(today|yesterday|week|weekly|month|monthly|all time|last week|previous week|last month|previous month|mois dernier|mes pasado|mês passado|hier|hoy|ontem|aujourd'hui|semaine|semana|mois|mes|mês)\b|আজ|গতকাল|গত\s*মাস|সপ্তাহ|মাস|आज|कल|पिछले महीने|महीने|اليوم|أمس|الأسبوع|الشهر الماضي|الشهر|今天|昨天|本周|上周|本月|上个月/u.test(text);
}

function amountAfterMarker(chunk: string, marker: RegExp): number | undefined {
  const match = marker.exec(chunk);
  if (!match) return undefined;
  const tail = chunk.slice(match.index + match[0].length);
  return extractNumbers(tail)[0];
}

function amountBeforeMarker(chunk: string, marker: RegExp): number | undefined {
  const match = marker.exec(chunk);
  if (!match) return undefined;
  return extractNumbers(chunk.slice(0, match.index)).at(-1);
}

function amountNearPriceMarker(text: string, marker: RegExp): number | undefined {
  const amountBeforeLabel = new RegExp(`(?:@\\s*|\\bat\\s+|(?:₹|Rs\\.?|INR)\\s*)(\\d+(?:\\.\\d+)?)\\s*(?:${marker.source})`, "iu").exec(text);
  if (amountBeforeLabel) return Number(amountBeforeLabel[1]);
  return amountAfterMarker(text, marker);
}

function itemDetails(chunk: string, _product: Product, alias: string): { qty: number | null; price?: number } {
  const normalized = normalize(chunk);
  const aliasIndex = normalized.indexOf(normalize(alias));
  const beforeProduct = aliasIndex >= 0 ? normalized.slice(0, aliasIndex) : normalized;
  const afterProduct = aliasIndex >= 0 ? normalized.slice(aliasIndex + normalize(alias).length) : "";
  let qty = extractNumbers(beforeProduct).at(-1) ?? null;
  if (qty === null && afterProduct && !/^\s*(?:at|@|for|price)\b/i.test(afterProduct)) qty = extractNumbers(afterProduct)[0] ?? null;
  let price = amountAfterMarker(chunk, /(?:\bat\b|@|\bper\s+(?:packet|bottle|unit|piece)\b)\s*/i);
  if (price === undefined && /\b(?:each|per unit)\b/i.test(chunk)) {
    const values = extractNumbers(chunk);
    if (values.length > 1) price = values.at(-1);
  }
  return { qty, price };
}

function parseItems(text: string, products: Product[]): { items: Array<{ productNameRaw: string; qty: number | null; price?: number }>; ambiguous?: string } {
  const items: Array<{ productNameRaw: string; qty: number | null; price?: number }> = [];
  for (const chunk of splitItemChunks(text)) {
    const hits = productHits(chunk, products);
    if (!hits.length) continue;
    const topLength = normalize(hits[0].alias).length;
    const best = hits.filter((hit) => normalize(hit.alias).length === topLength);
    const uniqueProducts = [...new Map(best.map((hit) => [hit.product.id, hit.product])).values()];
    if (uniqueProducts.length > 1) {
      return { items, ambiguous: `I found more than one product for “${best[0].alias}”. Which one did you mean?` };
    }
    const hit = best[0];
    const details = itemDetails(chunk, hit.product, hit.alias);
    items.push({ productNameRaw: hit.alias, qty: details.qty, ...(details.price !== undefined ? { price: details.price } : {}) });
  }
  return { items };
}

const productCreationPrefixes: RegExp[] = [
  /^(?:please\s+)?(?:add|create|make)\s+(?:a\s+)?(?:new\s+)?product(?:\s+(?:named|called))?\s*/iu,
  /^new\s+product\s*/iu,
  /^(?:ajoute|ajouter|crée|créer)\s+(?:un\s+)?(?:nouveau\s+)?produit(?:\s+(?:nommé|appelé))?\s*/iu,
  /^(?:añade|agrega|crea|crear|añadir)\s+(?:un\s+)?(?:nuevo\s+)?producto(?:\s+(?:llamado|denominado))?\s*/iu,
  /^(?:adicione|adicionar|crie|criar)\s+(?:um\s+)?(?:novo\s+)?produto(?:\s+(?:chamado|nomeado))?\s*/iu,
  /^(?:एक\s+)?(?:नया|नई|नए)\s+(?:उत्पाद|प्रोडक्ट)\s*(?:जोड़ें|जोड़ो|बनाएं|बनाओ)?\s*/u,
  /^(?:जोड़ें|जोड़ो|बनाएं|बनाओ)\s+(?:एक\s+)?(?:नया|नई|नए)?\s*(?:उत्पाद|प्रोडक्ट)\s*/u,
  /^(?:उत्पाद|प्रोडक्ट)\s*(?:जोड़ें|जोड़ो|बनाएं|बनाओ)?\s*(?:नया|नई)?\s*/u,
  /^(?:নতুন\s+)?(?:পণ্য|প্রোডাক্ট)\s*(?:যোগ\s+করুন|তৈরি\s+করুন|যোগ|তৈরি)?\s*/u,
  /^(?:যোগ\s+করুন|যোগ\s+করো|তৈরি\s+করুন|তৈরি\s+করো)\s*(?:একটি\s+)?(?:নতুন\s+)?(?:পণ্য|প্রোডাক্ট)\s*/u,
  /^(?:أضف|اضف|أنشئ|انشئ|إنشاء)\s*(?:منتجًا?|منتج)?\s*(?:جديدًا?|جديد)?\s*/u,
  /^(?:添加|新增|创建)\s*(?:一个)?\s*(?:新)?\s*(?:商品|产品)\s*/u,
];

const sellPriceMarker = /(?:selling\s*price|sell(?:ing)?\s*price|retail\s*price|mrp|prix\s+de\s+vente|precio\s+de\s+venta|preço\s+de\s+venda|سعر\s*البيع|বিক্রয়মূল্য|বিক্রির\s*দাম|बिक्री\s*मूल्य|विक्रय\s*मूल्य|售价|销售价|\bsell\b)/iu;
const costPriceMarker = /(?:cost\s*price|buying\s*price|purchase\s*price|cost|prix\s+(?:de\s+revient|d'achat)|coût|costo|coste|precio\s+de\s+costo|preço\s+de\s+custo|custo|سعر\s*التكلفة|التكلفة|(?<!বি)ক্রয়মূল্য|ক্রয়ের\s*দাম|কেনার\s*দাম|लागत\s*मूल्य|खरीद\s*मूल्य|成本|进价)/iu;
const openingStockMarker = /(?:opening\s+stock|stock\s+initial|cantidad\s+inicial|estoque\s+inicial|opening\s+quantity|quantity|qty|stock|الكمية|المخزون\s*الافتتاحي|শুরুর\s*মজুত|প্রারম্ভিক\s*মজুত|शुरुआती\s*स्टॉक|प्रारंभिक\s*स्टॉक|初始库存|库存)/iu;
const productFieldMarker = new RegExp(`${sellPriceMarker.source}|${costPriceMarker.source}|${openingStockMarker.source}`, "iu");
const attributedPriceMarker = /(?:@\s*(?:₹|Rs\.?|INR)?\s*\d+(?:\.\d+)?|\bat\s+(?:₹|Rs\.?|INR)?\s*\d+(?:\.\d+)?|(?:₹|Rs\.?|INR)\s*\d+(?:\.\d+)?)\s*(?:cost|sell(?:ing)?(?:\s*price)?)/iu;

function productCreationRequested(text: string): boolean {
  const lower = text.toLocaleLowerCase();
  return /\b(?:bought|purchased|got|received)\b.*\bnew\s+(?:product|item)\b/iu.test(lower)
    || /\b(add|create|make|new)\s+(?:a\s+)?(?:new\s+)?product\b/iu.test(lower)
    || /(?:ajoute|ajouter|crée|créer).*\bproduit\b/iu.test(lower)
    || /\b(?:añade|agrega|crea|crear|añadir)\b.*\bproducto\b/iu.test(lower)
    || /\b(?:adicione|adicionar|crie|criar)\b.*\bproduto\b/iu.test(lower)
    || /(?:नया|नई|नए)\s*(?:उत्पाद|प्रोडक्ट)|(?:उत्पाद|प्रोडक्ट)\s*(?:जोड़ें|जोड़ो|बनाएं|बनाओ)/u.test(lower)
    || /(?:नতুন\s+)?(?:পণ্য|প্রোডাক্ট)(?:\s+.+)?\s*(?:যোগ\s*করুন|যোগ\s*করো|তৈরি\s*করুন|তৈরি\s*করো|যোগ|তৈরি)/u.test(lower)
    || /(?:যোগ\s*করুন|যোগ\s*করো|তৈরি\s*করুন|তৈরি\s*করো)\s*(?:নতুন\s*)?(?:পণ্য|প্রোডাক্ট)/u.test(lower)
    || /(?:أضف|اضف|أنشئ|انشئ|إنشاء)\s*(?:منتج|منتجًا)/u.test(lower)
    || /(?:添加|新增|创建)\s*(?:一个)?\s*(?:新)?\s*(?:商品|产品)/u.test(lower);
}

function productNameFromCommand(text: string): string {
  let remainder = text.trim();
  const prefix = productCreationPrefixes.find((pattern) => pattern.test(remainder));
  if (prefix) remainder = remainder.replace(prefix, "");
  else {
    const newProductMention = /\bnew\s+(?:product|item)\s*/iu.exec(remainder);
    if (newProductMention?.index !== undefined) remainder = remainder.slice(newProductMention.index + newProductMention[0].length);
  }
  remainder = remainder.replace(/^(?:named|called|nommé|appelé|llamado|denominado|chamado|nomeado|नाम|নাম|اسم)\s*/iu, "");
  const fieldMarker = productFieldMarker.exec(remainder);
  const attributedPrice = attributedPriceMarker.exec(remainder);
  const purchaseMarker = /(?:,|;|\s)\s*(?:bought|purchased|buy|purchase|from\s+(?:the\s+)?supplier|supplier)\b/iu.exec(remainder);
  const openingQuantityMarker = /\b\d+(?:\.\d+)?\s*(?:pieces?|units?|pcs?|items?)\s+(?:were\s+)?(?:purchased|bought|received)\b/iu.exec(remainder);
  const stopAt = [fieldMarker?.index, attributedPrice?.index, purchaseMarker?.index, openingQuantityMarker?.index].filter((index): index is number => index !== undefined).sort((a, b) => a - b)[0];
  if (stopAt !== undefined) remainder = remainder.slice(0, stopAt);
  remainder = remainder.replace(/\s*(?:जोड़ें|जोड़ो|बनाएं|बनाओ|যোগ\s*করুন|যোগ\s*করো|তৈরি\s*করুন|তৈরি\s*করো)\s*$/u, "");
  return remainder.replace(/^[\s:：，,،;\-–]+|[\s:：，,،;\-–]+$/gu, "").replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "").trim();
}

function productUpdateIntent(text: string, products: Product[]): ParsedIntent | null {
  const lower = text.toLocaleLowerCase();
  const editVerb = /\b(update|edit|change|set|rename|adjust|modifier|changer|renommer|actualizar|editar|cambiar|renombrar|ajustar|atualizar|alterar|mudar|definir|renomear)\b|(?:mettre\s+à\s+jour|بَدِّل|تغيير|تحديث|عدّل|غيّر|تعديل|修改|更改|变更|改名|বদল|পরিবর্তন|সম্পাদনা|আপডেট|अपडेट|बदल|संपादित)/iu.test(lower);
  if (!editVerb || productCreationRequested(text)) return null;
  const hits = productHits(text, products);
  if (!hits.length) return null;

  const changes: Record<string, unknown> = {};
  const sellPrice = amountAfterMarker(text, sellPriceMarker)
    ?? (!costPriceMarker.test(text) && /\bprice\b/i.test(text) ? amountAfterMarker(text, /\bprice\s*(?:to|at)?\s*/i) : undefined);
  const costPrice = amountAfterMarker(text, costPriceMarker);
  const stockAlertMarker = /(?:stock\s+alert(?:\s+(?:at|threshold))?|low[\s-]*stock\s+(?:alert|threshold)|alert\s+threshold|reorder\s+(?:point|level)|minimum\s+stock|(?:seuil|alerte)\s+(?:d['’]alerte\s+)?(?:de\s+)?stock|(?:umbral|alerta)\s+(?:de\s+)?(?:stock|inventario)|(?:limite|alerta)\s+(?:de\s+)?(?:estoque|stock)|স্টক\s*(?:অ্যালার্ট|সতর্কতা)|কম[\s-]*স্টক\s*(?:সীমা|থ্রেশহোল্ড)|कम[\s-]*स्टॉक\s*(?:अलर्ट|सीमा)|تنبيه\s*المخزون|حد\s*المخزون|库存\s*(?:提醒|阈值))/iu;
  const lowStockThreshold = amountAfterMarker(text, stockAlertMarker);
  if (sellPrice !== undefined) changes.sellPrice = sellPrice;
  if (costPrice !== undefined) changes.costPrice = costPrice;
  if (lowStockThreshold !== undefined) changes.lowStockThreshold = lowStockThreshold;

  const rename = text.match(/\b(?:rename|renommer|renombrar|renomear)\s+(?:the\s+|le\s+|el\s+|o\s+)?(?:product\s+|produit\s+|producto\s+|produto\s+)?(.+?)\s+(?:to|as|called|en|como|para)\s+(.+?)\s*$/iu)
    ?? text.match(/\b(?:change|update|set|modifier|changer|actualizar|editar|cambiar|atualizar|alterar|mudar)\s+(?:the\s+|le\s+|el\s+|o\s+)?(?:product\s+|produit\s+|producto\s+|produto\s+)?name\s+(?:of\s+|de\s+|del\s+|do\s+)?(.+?)\s+(?:to|as|à|a|para|como)\s+(.+?)\s*$/iu);
  if (rename) changes.name = (rename.length > 2 ? rename[2] : rename[1]).trim().replace(/[.?!]+$/, "").trim();

  const categoryMatch = text.match(/(?:category|catégorie|categoría|categoria|الفئة|类别|শ্রেণি|বিভাগ|ক্যাটাগরি|श्रेणी)\s+(?:to|as|à|a|para|como|হবে|में|إلى|为)?\s*([\p{L}\p{M}\p{N}\- ]+?)(?=$|[,;.]|\s+(?:and|with|et|y|e)\s+(?:sell|cost|stock|unit|name|category|prix|coste|custo)\b)/iu);
  if (categoryMatch?.[1]?.trim()) changes.category = categoryMatch[1].trim();
  const unitMatch = text.match(/(?:\bunit|\bunité|\bunidad|\bunidade|الوحدة|单位)\s+(?:to|as|à|a|para|como|إلى|为)\s+([\p{L}\p{M}\p{N}\- ]+?)(?=$|[,;.]|\s+(?:and|with|et|y|e)\s+(?:sell|cost|stock|category|prix|coste|custo)\b)/iu);
  if (unitMatch?.[1]?.trim()) changes.unit = unitMatch[1].trim();

  if (!Object.keys(changes).length) {
    const language = detectLanguage(text);
    const requestsOnHandChange = /\b(?:current\s+stock|on[ -]?hand|stock\s+(?:quantity|qty)|quantity)\b(?:\s+(?:of|for)\s+[\p{L}\p{M}\p{N}'’ -]+?)?\s+(?:to|at|is)\b|\bstock\s+(?:to|is)\b|(?:বর্তমান\s*স্টক|স্টক\s*(?:পরিমাণ|সংখ্যা)|मौजूदा\s*स्टॉक|स्टॉक\s*(?:मात्रा|संख्या))/iu.test(text);
    return { intent: "UNKNOWN", responseLanguage: language, confidence: 0.48, clarification: localizedMessage(language, requestsOnHandChange ? "product_stock_ledger" : "need_product_update") };
  }
  return { intent: "UPDATE_PRODUCT", confidence: 0.82, productNameRaw: hits[0].alias, ...changes } as ParsedIntent;
}

function commandIntent(text: string, products: Product[]): ParsedIntent {
  const lower = text.toLocaleLowerCase();
  const period = detectPeriod(lower);
  const hits = productHits(text, products);
  const writeVerb = /\b(sold|sell|bought|buy|purchased|paid|spent|record(?:ed)?|log(?:ged)?|lost|wasted|damaged|expired|update|updated|edit|edited|change|changed|set|rename|renamed|adjust|adjusted|modifier|changer|renommer|actualizar|editar|cambiar|renombrar|ajustar|atualizar|alterar|mudar|definir|renomear)\b|(?:বিক্রি|বেচা|কিনলাম|কিনেছি|দিলাম|দিয়েছি|নষ্ট\s*(?:হলো|হয়েছে)|বদল|পরিবর্তন|সম্পাদনা|अपडेट|बदल|बदलो|संपादित|बदलें|vendu|vends?|acheté|payé|vendí|vendió|vendemos|compré|compró|pagué|vendi|vendeu|vendemos|comprei|comprou|paguei|تحديث|عدّل|غيّر|تعديل|تغيير|修改|更改|变更|改名|modifier|changer|mettre\s+à\s+jour|renommer|ajuster|actualizar|editar|cambiar|renombrar|atualizar|alterar|mudar|definir|renomear|বদল|পরিবর্তন|সম্পাদনা|আপডেট|अपडेट|बदल|संपादित|售出|卖出|卖了|购买|进货|支付|记录)/iu.test(lower);
  const querySubject = /\b(sales?|purchases?|expenses?|loss(?:es)?|stock|inventory|profit|earnings|revenue|restock)\b|(?:বিক্রি|কেনা|ক্ষতি|খরচ|স্টক|মজুত|লাভ|ইনভেন্টরি|बिक्री|खरीद|खर्च|नुकसान|स्टॉक|मुनाफा|इन्वेंटरी|ventes?|achats?|dépenses?|pertes?|inventaire|bénéfice|ventas?|compras?|gastos?|pérdidas?|inventario|beneficio|ganancia|vendas?|despesas?|perdas?|estoque|inventário|lucro|مبيعات|مشتريات|مصروفات|خسائر|مخزون|المخزون|أرباح|ربح|销售|采购|费用|损耗|库存|利润)/iu.test(lower);
  const query = hasQueryMarker(lower) || (!writeVerb && querySubject && (periodMentioned(lower) || extractNumbers(lower).length === 0));
  const transactionType = transactionTypeIn(lower);
  const asksCount = /\b(how many|count|number of|total number|total transactions?|transactions? total|transactions? count|count of|records? count|total records?)\b|(?:কয়টি|কতগুলো|মোট লেনদেন|কতটি লেনদেন|कितने|कितनी|कुल लेनदेन|combien de transactions|cuántas transacciones|cuántos registros|quantas transações|quantos registros|كم عدد المعاملات|عدد المعاملات|多少笔交易|交易总数)/iu.test(lower);
  const asksHistory = /\b(history|historical|recent|list|show me|what did i|records?)\b|(?:ইতিহাস|তালিকা|লেনদেন|রেকর্ড|इतिहास|लेनदेन|रिकॉर्ड|historique|historial|histórico|transacciones|transações|سجل|معاملات|历史|记录|交易)/u.test(lower);
  const asksTop = /\b(top|best.?sell|most sold|popular|fastest.?moving)\b|(?:সবচেয়ে বেশি বিক্রি|সবচেয়ে বেশি বিক্রি|सबसे ज्यादा बिक|meilleures ventes|más vendidos|mais vendidos|الأكثر مبيعًا|畅销)/u.test(lower);
  const asksMovement = /\b(movement|moved|bought and sold|stock flow|stock change|how much.*(bought|sold|lost))\b|(?:মজুত.*(কেনা|বিক্রি|ক্ষতি)|स्टॉक.*(खरीद|बिक्री|नुकसान)|حركة المخزون|库存变动)/u.test(lower);
  const asksCurrentProduct = /\b(product details|details for|tell me about|what is.*price|selling price|cost price|price of|how many.*left|current stock|stock of|inventory of)\b|(?:দাম কত|কত আছে|মজুত কত|স্টক কত|কতটা আছে|कीमत|कितना बचा|स्टॉक कितना|السعر|كم بقي|价格|还剩多少)/u.test(lower);
  const periodForHistory = periodMentioned(lower) ? period : "all";

  // Resolve questions before write commands, so “what did I buy?” cannot become a purchase.
  if (query && asksTop) return { intent: "QUERY_TOP_PRODUCTS", confidence: 0.9, period: periodMentioned(lower) ? period : "week", limit: 5 };
  if (query && asksCount) return { intent: "QUERY_TRANSACTIONS", confidence: 0.9, period, transactionType, ...(hits[0] ? { productNameRaw: hits[0].alias } : {}) };
  if (query && (asksHistory || /\btransactions?\b/.test(lower))) return { intent: "QUERY_HISTORY", confidence: 0.9, period: periodForHistory, transactionType, limit: 5, ...(hits[0] ? { productNameRaw: hits[0].alias } : {}) };
  if (query && transactionType === "loss") return { intent: "QUERY_LOSSES", confidence: 0.9, period, ...(hits[0] ? { productNameRaw: hits[0].alias } : {}) };
  if (query && asksMovement) return { intent: "QUERY_STOCK_MOVEMENT", confidence: 0.87, period: periodMentioned(lower) ? period : "month", ...(hits[0] ? { productNameRaw: hits[0].alias } : {}) };
  if (query && (transactionType === "sale" || /\b(revenue|sales?)\b|বিক্রি|বেচা|बिक्री|ventes?|ventas|vendas|مبيعات|销售/u.test(lower))) return { intent: "QUERY_SALES", confidence: 0.93, period, ...(hits[0] ? { productNameRaw: hits[0].alias } : {}) };
  if (query && transactionType === "purchase") return { intent: "QUERY_PURCHASES", confidence: 0.9, period, ...(hits[0] ? { productNameRaw: hits[0].alias } : {}) };
  if (query && transactionType === "expense") return { intent: "QUERY_EXPENSES", confidence: 0.88, period, category: expenseCategory(lower) };
  if (query && /\b(profit|earnings|net)\b|লাভ|মুনাফা|लाभ|मुनाफा|bénéfice|ganancia|lucro|ربح|利润/u.test(lower)) return { intent: "QUERY_PROFIT", confidence: 0.94, period };
  if (query && (asksCurrentProduct || /\b(stock|inventory|low stock|reorder|restock)\b|স্টক|মজুত|ইনভেন্টরি|स्टॉक|भंडार|المخزون|库存/u.test(lower))) {
    if (hits[0] && asksCurrentProduct) return { intent: "QUERY_PRODUCT", confidence: 0.91, productNameRaw: hits[0].alias };
    return { intent: "QUERY_INVENTORY", confidence: 0.91, focus: /\b(low|restock|reorder|order)\b|কম\s+স্টক|कम\s+स्टॉक|قليل/u.test(lower) ? "low_stock" : "all", ...(hits[0] ? { productNameRaw: hits[0].alias } : {}) };
  }

  if (productCreationRequested(text)) {
    const name = productNameFromCommand(text);
    const sellPrice = amountNearPriceMarker(text, sellPriceMarker);
    const costPrice = amountNearPriceMarker(text, costPriceMarker);
    const withoutStockAlert = text.replace(/(?:low[\s-]*stock(?:\s+(?:alert|threshold))?|stock\s+(?:alert|threshold)|reorder\s+(?:point|level))\s*(?:at|of|to|is|=|:)?\s*(?:₹|Rs\.?|INR)?\s*\d+(?:\.\d+)?/giu, " ");
    const explicitOpeningStock = amountAfterMarker(withoutStockAlert, openingStockMarker);
    const purchasedQty = amountAfterMarker(text, /\b(?:bought|purchased|purchase|received|got)\s*/iu);
    const purchasedQtyBeforeUnit = amountBeforeMarker(text, /(?:pieces?|units?|pcs?|items?)\s+(?:were\s+)?(?:purchased|bought|received)\b/iu);
    const openingStock = explicitOpeningStock ?? purchasedQty ?? purchasedQtyBeforeUnit ?? 0;
    const purchaseUnitCost = amountAfterMarker(text, /\b(?:bought|purchased|purchase)\b[\s\S]*?\b(?:at|@)\s*(?:₹|Rs\.?|INR)?\s*/iu);
    if (name) {
      return {
        intent: "CREATE_PRODUCT", confidence: 0.77, name,
        category: "General", unit: openingStock > 0 && /\bpieces?\b/iu.test(text) ? "piece" : "unit",
        sellPrice: sellPrice ?? null,
        costPrice: costPrice ?? null,
        openingStock,
        ...(purchaseUnitCost !== undefined ? { purchaseUnitCost } : {}),
        supplier: supplierFrom(text),
        lowStockThreshold: 10,
      };
    }
    return { intent: "UNKNOWN", confidence: 0.48, clarification: "Tell me the product name, selling price, and cost price, or use Add product." };
  }

  const updateProductIntent = productUpdateIntent(text, products);
  if (updateProductIntent) return updateProductIntent;

  if (/\b(rat|mouse|mice|ate|eaten|spoiled|spoilt|expired|damaged|broken|broke|wasted|waste|lost|loss|thrown away|leaked)\b|(?:ইঁদুর|খেয়েছে|খেয়েছে|নষ্ট|মেয়াদ|नष्ट|खराब|टूट|नुकसान|perdu|perdue|cassé|abîmé|périmé|perdido|perdida|dañado|vencido|quebrado|danificado|تلف|فقد|منتهي|丢失|损坏|过期|坏了)/iu.test(lower)) {
    const parsed = parseItems(text, products);
    if (parsed.ambiguous) return { intent: "UNKNOWN", confidence: 0.42, clarification: parsed.ambiguous };
    if (!parsed.items.length) return { intent: "UNKNOWN", confidence: 0.35, clarification: "Which product was lost or damaged? Please include its name and quantity." };
    if (parsed.items.length > 1) return { intent: "UNKNOWN", confidence: 0.5, clarification: "Please record one product loss at a time so I can confirm its stock impact." };
    const item = parsed.items[0];
    return { intent: "RECORD_LOSS", confidence: 0.78, productNameRaw: item.productNameRaw, qty: item.qty, reason: lossReason(lower) };
  }

  if (/\b(paid|spent|expense|electricity bill|rent|transport|salary|wages|bill)\b|(?:খরচ|দিয়েছি|দিলাম|ভাড়া|ভাড়া|বিদ্যুৎ|खर्च|दिया|दिए|भुगतान|किराया|बिजली|payé|dépense|gasto|pagué|pagó|despesa|paguei|pagou|مصروف|دفعت|إيجار|كهرباء|费用|支付|付了|租金|电费)/iu.test(lower) && !/\b(sold|sale)\b|(?:বিক্রি|बेच|बिक्री|vendu|vendi|vendeu|بعت|卖了|售出)/iu.test(lower)) {
    const amount = extractNumbers(text).at(-1) ?? null;
    return { intent: "RECORD_EXPENSE", confidence: amount ? 0.85 : 0.52, category: expenseCategory(lower), amount, note: cleanNote(text) };
  }

  if (/\b(bought|buy|purchase|purchased|restocked|restock|received stock|got stock|supplier|stock came)\b|\bgot\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty)\b|(?:কিনেছি|কিনলাম|কেনা|खरीदा|खरीदी|खरीदे|खरीद लिया|आए|मिला|acheté|achetee|compré|compró|comprei|comprou|اشتريت|وصلت|买了|采购|进货)/iu.test(lower)) {
    const parsed = parseItems(text, products);
    if (parsed.ambiguous) return { intent: "UNKNOWN", confidence: 0.4, clarification: parsed.ambiguous };
    if (!parsed.items.length) return { intent: "UNKNOWN", confidence: 0.35, clarification: "Which product did you restock, and how many units arrived?" };
    return {
      intent: "RECORD_PURCHASE",
      confidence: 0.8,
      items: parsed.items.map((item) => ({ productNameRaw: item.productNameRaw, qty: item.qty, unitCost: item.price ?? null })),
      supplier: supplierFrom(text),
    };
  }

  if (/\b(sold|sell|sale|becha|bikri|bechi|vendu|vends?|vendí|vendió|vendemos|vendi|vendeu|bought|buy)\b|(?:বিক্রি|বেচা|बेचा|बेची|बेचे|बेचो|बेचें|बेचिए|बिक्री|بعت|卖了|售出|销售)/iu.test(lower)) {
    const parsed = parseItems(text, products);
    if (parsed.ambiguous) return { intent: "UNKNOWN", confidence: 0.4, clarification: parsed.ambiguous };
    if (!parsed.items.length) return { intent: "UNKNOWN", confidence: 0.35, clarification: "I couldn't match a product. Try its catalog name, for example “sold 5 Maggi at 14 each”." };
    return {
      intent: "RECORD_SALE",
      confidence: 0.82,
      items: parsed.items.map((item) => ({ productNameRaw: item.productNameRaw, qty: item.qty, unitPrice: item.price ?? null })),
    };
  }

  return { intent: "UNKNOWN", confidence: 0.2, clarification: "I can record a sale, purchase, expense, stock loss, or product—or answer questions about sales, profit, and inventory." };
}

function expenseCategory(text: string): "rent" | "electricity" | "transport" | "staff" | "misc" {
  if (/\b(electric(?:ity)?|power|current|bijli)\b|বিদ্যুৎ|बिजली|électricité|electricidad|eletricidade|كهرباء|电费/u.test(text)) return "electricity";
  if (/\b(rent|shop rent)\b|ভাড়া|ভাড়া|किराया|loyer|alquiler|aluguel|إيجار|租金/u.test(text)) return "rent";
  if (/\b(transport|delivery|auto|fuel|petrol)\b|পরিবহন|परिवहन|transport|transporte|نقل|运输/u.test(text)) return "transport";
  if (/\b(salary|staff|wages|worker)\b|বেতন|বেতন|वेतन|personnel|salario|equipe|موظف|员工/u.test(text)) return "staff";
  return "misc";
}

function lossReason(text: string): string {
  if (/\b(rat|mouse|mice)\b/.test(text)) return "Rat damage";
  if (/\b(spoil|spoilt|expired)\b/.test(text)) return "Spoiled or expired";
  if (/\b(break|broke|broken|damage)\b/.test(text)) return "Damaged goods";
  if (/\b(leak|leaked)\b/.test(text)) return "Leakage";
  return "Stock loss";
}

function cleanNote(text: string): string {
  return text.trim().replace(/^(?:i\s+)?(?:paid|spent|record(?:ed)?(?:\s+an?)?\s+expense\s+(?:of\s+)?)/i, "").replace(/[.?!]+$/, "").trim() || "Shop expense";
}

function supplierFrom(text: string): string {
  const match = text.match(/(?:\bfrom\b|\bsupplier\b\s*(?::|is)?\s*)(?:the\s+)?(.+?)(?:\s+(?:for|at|cost|each|selling|sell)\s+(?:₹|Rs\.?|INR)?\d|[,.]|$)/i);
  return match?.[1]?.trim() || "Local supplier";
}

export function parseWithRules(transcript: string, products: Product[], preferredLanguage?: ConversationLanguage): ParsedIntent {
  const intent = commandIntent(transcript, products);
  return { ...intent, responseLanguage: preferredLanguage ?? detectLanguage(transcript) };
}
