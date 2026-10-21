// Czyste funkcje normalizujące odpowiedzi API webePartners (bez I/O — łatwe do testowania).
import { CATEGORIES, DEFAULT_CATEGORY, MAX_TRUSTED_CUT } from '../src/config/site.mjs';

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

/** Zwraca znormalizowany produkt albo null (z powodem odrzucenia w drugim polu). */
export function normalizeProduct(raw, { excludedWords = [], programCategory = '' } = {}) {
  const price = parsePrice(raw.productPrice);
  if (!(price > 0)) return { reject: 'cena' };
  const images = toArray(raw.productImages?.productImagesUrl).filter(isHttpUrl);
  const image = images[0] ?? (isHttpUrl(raw.productImages?.productThumbUrl) ? raw.productImages.productThumbUrl : null);
  if (!image) return { reject: 'zdjęcie' };
  if (!isHttpUrl(raw.productTrackingUrl)) return { reject: 'link' };
  if (!raw.productName || !String(raw.productName).trim()) return { reject: 'nazwa' };

  const catNames = toArray(raw.category?.webeCategoryName);
  const catText = [...catNames, raw.shopCategoryName, raw.productName].join(' | ');
  if (isExcluded(catText, excludedWords)) return { reject: 'kategoria wykluczona' };

  let cut = parsePrice(raw.priceCut);
  let oldPrice = null;
  if (cut > 0 && cut <= MAX_TRUSTED_CUT) {
    oldPrice = round2(price / (1 - cut / 100));
  } else {
    // brak/niewiarygodny priceCut — spróbuj z historii cen (najwyższa cena wyższa od obecnej)
    const prev = toArray(raw.previousPrice).map((p) => parsePrice(p?.price)).filter((p) => p > price);
    cut = 0;
    if (prev.length) {
      const max = Math.max(...prev);
      const derived = Math.round((1 - price / max) * 100);
      if (derived > 0 && derived <= MAX_TRUSTED_CUT) {
        oldPrice = round2(max);
        cut = derived;
      }
    }
  }
  const discount = oldPrice ? Math.round(cut) : 0;

  return {
    product: {
      id: String(raw.webeProductId),
      name: String(raw.productName).trim(),
      description: stripHtml(raw.productDescritption ?? raw.productDescription, 200),
      image,
      brand: (raw.productBrand ?? '').trim() || null,
      programId: Number(raw.programId),
      price: round2(price),
      oldPrice,
      discount,
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
