// Dostęp do danych wygenerowanych przez scripts/fetch-data.mjs (src/data/*.json).
import products from '../data/products.json';
import vouchers from '../data/vouchers.json';
import shops from '../data/shops.json';
import meta from '../data/meta.json';
import { CATEGORIES, COLLECTIONS } from '../config/site.mjs';

export { products, vouchers, shops, meta };

export const shopById = new Map(shops.map((s) => [s.programId, s]));
export const shopBySlug = new Map(shops.map((s) => [s.slug, s]));
export const categoryBySlug = new Map(CATEGORIES.map((c) => [c.slug, c]));

/** Dokleja parametry śledzenia źródła sprzedaży: param1=www, param2=<typ strony>. */
export function trackedUrl(url, pageType) {
  const u = new URL(url);
  u.searchParams.set('param1', 'www');
  u.searchParams.set('param2', pageType);
  return u.toString();
}

const plnFmt = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
export const formatPrice = (n) => plnFmt.format(n);

const dateFmt = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Warsaw' });
export const formatDate = (iso) => dateFmt.format(new Date(iso));
export const updatedDate = formatDate(meta.updatedAt);

/** Termin ważności kodu — zawsze pokazujemy datę z API (bez „bezterminowo”, żeby nie sugerować więcej niż wiemy). */
export function validityLabel(iso) {
  return iso ? `Ważny do ${formatDate(iso)}` : 'Termin ważności: sprawdź w sklepie';
}

export const productsByDiscount = [...products].sort((a, b) => b.discount - a.discount || a.price - b.price);

/** Sklepy mające co najmniej jeden produkt lub kod. */
export const activeShops = shops.filter(
  (s) => products.some((p) => p.programId === s.programId) || vouchers.some((v) => v.programId === s.programId)
);

export const activeCategories = CATEGORIES.map((c) => ({
  ...c,
  count: products.filter((p) => p.category === c.slug).length
})).filter((c) => c.count > 0);

/** Obniżki zgodne z polityką cen (świeże, z ceną odniesienia) — tylko te dostają znaczek -X%. */
export const dealProducts = productsByDiscount.filter((p) => p.discount > 0);

export function collectionProducts(c) {
  return products
    .filter((p) => (c.max == null || p.price <= c.max) && (c.min == null || p.price > c.min))
    .sort((a, b) => b.discount - a.discount || a.price - b.price);
}

/** Kolekcje, które mają co najmniej 3 produkty. */
export const activeCollections = COLLECTIONS.map((c) => ({ ...c, items: collectionProducts(c) })).filter((c) => c.items.length >= 3);
