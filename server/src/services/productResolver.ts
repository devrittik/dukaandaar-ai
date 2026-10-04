import type { Product } from "../types.js";
import { isEnglishProductSearchText, translateProductReferenceToEnglish } from "./productAliases.js";

const SIZE_TOKEN = /\b\d+(?:[.,]\d+)?\s*(?:kg|kgs|g|gm|gms|gram|grams|ml|l|lt|ltr|litre|litres|liter|liters|pcs?|pieces?|packets?|pouches?|bottles?|boxes?|count|nos?)\b/giu;

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

function searchForms(value: string): string[] {
  const english = translateProductReferenceToEnglish(value);
  if (!english) return [];
  const normalized = normalize(english);
  const withoutSize = normalize(english.replace(SIZE_TOKEN, " ").replace(/\s+/g, " ").trim());
  return [...new Set([normalized, withoutSize].filter(Boolean))];
}

function tokenCoverageScore(target: string, candidate: string): number {
  const targetTokens = [...new Set(normalize(target).split(/\s+/u).filter(Boolean))];
  const candidateTokens = new Set(normalize(candidate).split(/\s+/u).filter(Boolean));
  if (!targetTokens.length) return 0;
  const coverage = targetTokens.filter((token) => candidateTokens.has(token)).length / targetTokens.length;
  if (coverage < 1) return coverage * 0.75;
  return 0.84 + 0.1 * (targetTokens.length / Math.max(candidateTokens.size, targetTokens.length));
}

function similarity(left: string, right: string): number {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

function englishTerms(product: Product): string[] {
  return [product.name, ...product.aliases].filter(isEnglishProductSearchText);
}

export type ProductResolution =
  | { status: "matched"; product: Product; score: number }
  | { status: "ambiguous"; candidates: Product[] }
  | { status: "not_found" };

/** Search only English product names/aliases; callers translate non-English references before lookup. */
export function resolveProduct(raw: string, products: Product[]): ProductResolution {
  const targets = searchForms(raw);
  if (!targets.length) return { status: "not_found" };
  const fullTarget = targets[0];
  const exactFull = products.filter((product) => englishTerms(product).some((alias) => normalize(alias) === fullTarget));
  if (exactFull.length === 1) return { status: "matched", product: exactFull[0], score: 1 };
  if (exactFull.length > 1) return { status: "ambiguous", candidates: exactFull };

  if (fullTarget.includes(" ")) {
    const specificScores = products.map((product) => ({
      product,
      score: Math.max(0, ...englishTerms(product).map((alias) => tokenCoverageScore(fullTarget, alias))),
    })).sort((a, b) => b.score - a.score);
    if (specificScores.length && specificScores[0].score >= 0.84) {
      const tied = specificScores.filter((entry) => Math.abs(entry.score - specificScores[0].score) < 0.035);
      if (tied.length === 1) return { status: "matched", product: specificScores[0].product, score: specificScores[0].score };
      return { status: "ambiguous", candidates: tied.map((entry) => entry.product) };
    }
  }

  const exact = products.filter((product) => englishTerms(product).some((alias) => targets.slice(1).includes(normalize(alias))));
  if (exact.length === 1) return { status: "matched", product: exact[0], score: 1 };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact };

  const scores = products.map((product) => ({
    product,
    score: Math.max(0, ...targets.flatMap((target) => englishTerms(product).map((alias) => similarity(target, alias)))),
  })).sort((a, b) => b.score - a.score);
  if (!scores.length || scores[0].score < 0.78) return { status: "not_found" };
  const tied = scores.filter((entry) => Math.abs(entry.score - scores[0].score) < 0.035);
  if (tied.length > 1) return { status: "ambiguous", candidates: tied.map((entry) => entry.product) };
  return { status: "matched", product: scores[0].product, score: scores[0].score };
}
