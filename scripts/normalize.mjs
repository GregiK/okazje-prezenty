// Czyste funkcje normalizujące odpowiedzi API webePartners (bez I/O — łatwe do testowania).
import { CATEGORIES, DEFAULT_CATEGORY, MAX_TRUSTED_CUT, DEAL_MAX_AGE_DAYS } from '../src/config/site.mjs';

/** Odpowiedź może być tablicą albo obiektem z tablicą w polu data/items/result. */
export function unwrapArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of ['data', 'items', 'result', 'Data', 'Items', 'Result']) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }
  return [];
}

/** Cena jako liczba albo string z przecinkiem ("1 299,90"). Zwraca NaN gdy nie da się sparsować. */
export function parsePrice(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  return parseFloat(value.replace(/\s/g, '').replace(',', '.'));
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

export function slugify(text) {
  const map = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  return String(text)
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => map[c])
    .replace(/&/g, ' i ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function stripHtml(html, max = 280) {
  const text = String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

export function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

const MAX_IMAGES = 8;
const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Dopasowuje kategorię serwisu na podstawie tekstu kategorii z API. */
export function matchCategory(...texts) {
  const haystack = texts.flat().filter(Boolean).join(' | ').toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keys.some((k) => haystack.includes(k))) return cat.slug;
  }
  return DEFAULT_CATEGORY;
}

export function isExcluded(text, excludedWords) {
  const haystack = String(text ?? '').toLowerCase();
  return excludedWords.some((w) => haystack.includes(w.toLowerCase()));
}


const DAY = 864e5;

/**
 * Obniżka zgodna z duchem dyrektywy Omnibus. Cenę „przed obniżką” liczymy z historii cen, a nie z priceCut:
 * - początek obecnej ceny = data ostatniego wpisu historii, który równa się cenie dziś,
 * - cena odniesienia = najniższa cena z 30 dni przed tą datą (łącznie z ceną obowiązującą tuż przed zmianą),
 * - pokazujemy obniżkę tylko gdy jest świeża (obecna cena obowiązuje nie dłużej niż DEAL_MAX_AGE_DAYS),
 *   cena odniesienia jest wyższa od obecnej, a obniżka nie przekracza MAX_TRUSTED_CUT.
 * Brak historii albo starsza „obniżka” => brak przekreślonej ceny i znaczka -X%.
 */
export function computeDeal(price, previousPrice, now = new Date()) {
  const hist = toArray(previousPrice)
    .map((x) => ({ t: Date.parse(x?.createDate), p: parsePrice(x?.price) }))
    .filter((x) => Number.isFinite(x.t) && x.p > 0)
    .sort((a, b) => a.t - b.t);
  if (!hist.length) return null;
  const last = hist[hist.length - 1];
  if (Math.abs(last.p - price) > 0.005) return null; // historia nie kończy się na obecnej cenie
  const since = last.t;
  if (now.getTime() - since > DEAL_MAX_AGE_DAYS * DAY) return null;
  const before = hist.filter((x) => x.t < since);
  if (!before.length) return null;
  const inWindow = before.filter((x) => x.t >= since - 30 * DAY).map((x) => x.p);
  const reference = Math.min(before[before.length - 1].p, ...inWindow);
  if (!(reference > price)) return null;
  const discount = Math.round((1 - price / reference) * 100);
  if (discount < 1 || discount > MAX_TRUSTED_CUT) return null;
  return { reference: round2(reference), discount, since: new Date(since).toISOString() };
}

/** Zwraca znormalizowany produkt albo null (z powodem odrzucenia w drugim polu). */
export function normalizeProduct(raw, { excludedWords = [], excludedPhrases = [], excludedNameRegex = [], programCategory = '', now = new Date() } = {}) {
  const price = parsePrice(raw.productPrice);
  if (!(price > 0)) return { reject: 'cena' };
  const images = toArray(raw.productImages?.productImagesUrl).filter(isHttpUrl);
  const gallery = [...new Set(images.map((u) => u.trim()))].slice(0, MAX_IMAGES);
  if (!gallery.length && isHttpUrl(raw.productImages?.productThumbUrl)) gallery.push(raw.productImages.productThumbUrl.trim());
  const image = gallery[0];
  if (!image) return { reject: 'zdjęcie' };
  if (!isHttpUrl(raw.productTrackingUrl)) return { reject: 'link' };
  if (!raw.productName || !String(raw.productName).trim()) return { reject: 'nazwa' };

  const catNames = toArray(raw.category?.webeCategoryName);
  const catText = [...catNames, raw.shopCategoryName, raw.productName].join(' | ');
  if (isExcluded(catText, excludedWords)) return { reject: 'kategoria wykluczona' };
  const fullText = `${raw.productName} ${raw.productDescritption ?? raw.productDescription ?? ''}`;
  if (isExcluded(fullText, excludedPhrases)) return { reject: 'fraza wykluczona (np. zamiennik)' };
  if (excludedNameRegex.some((re) => new RegExp(re, 'i').test(String(raw.productName).trim()))) return { reject: 'nazwa wykluczona' };

  const deal = computeDeal(price, raw.previousPrice, now);
  const oldPrice = deal ? deal.reference : null;
  const discount = deal ? deal.discount : 0;

  return {
    product: {
      id: String(raw.webeProductId),
      name: String(raw.productName).trim(),
      description: stripHtml(raw.productDescritption ?? raw.productDescription, 200),
      image,
      images: gallery,
      brand: (raw.productBrand ?? '').trim() || null,
      programId: Number(raw.programId),
      price: round2(price),
      oldPrice,
      discount,
      dealSince: deal ? deal.since : null,
      category: matchCategory(catNames, raw.shopCategoryName, raw.productName, programCategory),
      url: raw.productTrackingUrl.trim()
    }
  };
}

/** Zwraca znormalizowany kod albo null. `now` — Date. */
export function normalizeVoucher(raw, now = new Date()) {
  if (!isHttpUrl(raw.voucherTrackingUrl)) return { reject: 'link' };
  const to = raw.dateTo ? new Date(raw.dateTo) : null;
  if (to && !isNaN(to) && to < now) return { reject: 'po terminie' };
  const from = raw.dateFrom ? new Date(raw.dateFrom) : null;
  if (from && !isNaN(from) && from > now) return { reject: 'jeszcze nieaktywny' };
  // Prawdziwy kod to jeden token bez spacji; opisy w stylu „zapis do newslettera” nie są kodem.
  const rawCode = String(raw.voucherCode ?? '').trim();
  const code = /^[\p{L}\p{N}_\-!%.]{3,40}$/u.test(rawCode) ? rawCode : '';
  const text = stripHtml(raw.voucherText, 280) || (rawCode && !code ? stripHtml(rawCode, 120) : '');
  return {
    voucher: {
      id: String(raw.voucherId),
      title: stripHtml(raw.voucherName, 160),
      text,
      code: code || null,
      type: raw.voucherTypeName ?? 'Promocja',
      programId: Number(raw.programId),
      validFrom: from && !isNaN(from) ? from.toISOString() : null,
      validTo: to && !isNaN(to) ? to.toISOString() : null,
      url: raw.voucherTrackingUrl.trim(),
      category: matchCategory(raw.categoryName, raw.voucherName)
    }
  };
}
