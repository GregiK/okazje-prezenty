// Product feedy LeadStar (productfeed.pl): pełne katalogi sklepów w XML (nawet 100+ MB, dziesiątki tysięcy produktów).
// Parsujemy strumieniowo (bez wczytywania całości do pamięci), mapujemy rekord na format webePartners i przepuszczamy
// przez te same reguły wykluczeń (normalizeProduct), a potem przycinamy do różnorodnego wyboru (capProducts).
// Feed nie ma historii cen — `old_price`/`is_promo` ze sklepu IGNORUJEMY (nie da się z nich uczciwie wykazać
// „najniższej ceny z 30 dni przed obniżką”), więc produkty są bez znaczka obniżki.
import { createHash } from 'node:crypto';
import { normalizeProduct, capProducts, isHttpUrl } from './normalize.mjs';

/** Przesunięcie ID programów z feedów (osobne od webePartners < 1 000 000 i od API LeadStar 1 000 000+). */
export const FEED_OFFSET = 2_000_000;

/** ID feedu (parametr fid) z adresu, albo null. */
export function feedId(url) {
  try { const n = Number(new URL(url).searchParams.get('fid')); return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** Wartość tagu z fragmentu XML (CDATA lub zwykły tekst). */
export function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${name}>`));
  if (!m) return null;
  return (m[1] !== undefined ? m[1] : decode(m[2])).trim();
}

/** Fragment `<product>…</product>` → obiekt z polami feedu. */
export function parseProduct(xml) {
  return {
    id: tag(xml, 'id'),
    url: tag(xml, 'product_url'),
    image: tag(xml, 'image_url'),
    name: tag(xml, 'name'),
    description: tag(xml, 'description'),
    price: tag(xml, 'price'),
    brand: tag(xml, 'manufacturer'),
    stock: tag(xml, 'stock')
  };
}

/** Dzieli strumień (kawałki Uint8Array) na kolejne fragmenty `<product>…</product>`. */
export async function* productChunks(stream) {
  const dec = new TextDecoder('utf-8');
  let buf = '';
  for await (const chunk of stream) {
    buf += dec.decode(chunk, { stream: true });
    let end;
    while ((end = buf.indexOf('</product>')) !== -1) {
      const start = buf.lastIndexOf('<product>', end);
      if (start !== -1) yield buf.slice(start, end + 10);
      buf = buf.slice(end + 10);
    }
    if (buf.length > 5_000_000) buf = buf.slice(-1_000_000); // zabezpieczenie przed uszkodzonym plikiem bez znaczników
  }
}

/** Rekord feedu → format „raw” webePartners (żeby użyć tych samych reguł co dla GetHotPrice). */
export function toRaw(p, fid) {
  return {
    webeProductId: createHash('sha1').update(`ls${fid}:${p.id}`).digest('hex'),
    productName: p.name,
    productDescritption: p.description,
    productBrand: p.brand,
    productPrice: p.price,
    productImages: { productImagesUrl: p.image ? [p.image] : [] },
    productTrackingUrl: p.url,
    programId: FEED_OFFSET + fid,
    category: { webeCategoryName: [] }, // kategorie w feedzie to nazwy z innego języka — dopasowujemy po nazwie produktu
    shopCategoryName: ''
  };
}

/** Domyślne przedziały cen i ich udział w wyborze (prezenty z różnych półek cenowych, nie tylko ~150 zł). */
export const DEFAULT_BANDS = [
  { min: 0, max: 50, target: 35, share: 0.2 },
  { min: 50, max: 100, target: 75, share: 0.3 },
  { min: 100, max: 200, target: 150, share: 0.25 },
  { min: 200, max: 400, target: 300, share: 0.15 },
  { min: 400, max: Infinity, target: 600, share: 0.1 }
];

/**
 * Przetwarza strumień feedu: zwraca produkty po regułach wykluczeń i przycięte do `cap` — po kolei z przedziałów cenowych,
 * różnorodnie (typy produktów, rodziny nazw, max `perBrand` z marki). Wybór jest deterministyczny (ten sam feed → ten sam wynik),
 * żeby strony produktów nie znikały i nie pojawiały się losowo.
 * `rules` — listy wykluczeń jak w normalizeProduct; `minPrice` odrzuca drobiazgi; `category` wymusza kategorię serwisu dla całego sklepu.
 */
/** Produkty „prezentowe” (perfumy, zestawy, świece, kuferki…) wybieramy w pierwszej kolejności. */
export const GIFT_RE = /zestaw|\bset\b|woda perfumowana|woda toaletowa|woda kolo|perfum|świec|dyfuzor|kuferek|\bbox\b|prezent/i;

export async function processFeed(stream, fid, { rules = {}, cap = 150, minPrice = 0, perBrand = 0, perFamily = 3, bands = DEFAULT_BANDS, category = null, prefer = GIFT_RE, now = new Date() } = {}) {
  const stats = { total: 0, rejected: {} };
  const bump = (why) => { stats.rejected[why] = (stats.rejected[why] ?? 0) + 1; };
  const list = [];
  for await (const xml of productChunks(stream)) {
    stats.total++;
    const p = parseProduct(xml);
    if (p.stock && p.stock.toLowerCase() !== 'in stock') { bump('niedostępny'); continue; }
    if (!p.id || !isHttpUrl(p.url)) { bump('brak id/linku'); continue; }
    if (!(Number.parseFloat(p.price) >= minPrice)) { bump('cena poniżej minimum'); continue; }
    const res = normalizeProduct(toRaw(p, fid), { ...rules, now });
    if (res.reject) { bump(res.reject); continue; }
    if (category) res.product.category = category;
    list.push(res.product);
  }
  let products = [];
  if (list.length <= cap) products = list;
  else {
    const picked = new Set();
    for (const b of bands) {
      const inBand = list.filter((x) => x.price > b.min && x.price <= b.max);
      const n = Math.round(cap * b.share);
      const opts = { targetPrice: b.target, perBrand, perFamily };
      const pref = prefer ? capProducts(inBand.filter((x) => prefer.test(x.name)), n, opts) : [];
      for (const x of pref) picked.add(x);
      if (pref.length < n) for (const x of capProducts(inBand.filter((x) => !picked.has(x)), n - pref.length, opts)) picked.add(x);
    }
    products = [...picked];
    if (products.length < cap) { // niedobór w którymś przedziale — uzupełniamy z reszty
      const rest = capProducts(list.filter((x) => !picked.has(x)), cap - products.length, { targetPrice: 150, perBrand, perFamily });
      products.push(...rest);
    }
  }
  return { products, stats: { ...stats, eligible: list.length, kept: products.length } };
}

/** Pobiera feed po HTTP (strumieniowo; duże pliki → długi limit czasu, 2 ponowienia). */
export async function fetchFeedStream(url, { fetchImpl = fetch, timeoutMs = 600_000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
      return res.body;
    } catch (e) {
      lastErr = e;
      if (e.status >= 400 && e.status < 500) break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw new Error(`feed: ${lastErr?.message ?? 'brak odpowiedzi'}`);
}
