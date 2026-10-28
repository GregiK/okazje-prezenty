import { activeShops, activeCollections, products, productPath, meta } from '../lib/data.mjs';

export function GET({ site }: { site: URL }) {
  const lastmod = meta.updatedAt.slice(0, 10);
  const paths = ['/', '/okazje', '/kody-rabatowe', '/kalkulator-obligacji', ...activeShops.map((s) => `/sklep/${s.slug}`), ...activeCollections.map((c) => `/prezenty/${c.slug}`), '/o-serwisie', '/polityka-prywatnosci', ...products.map((p) => productPath(p))];
  const urls = paths
    .map((p) => `  <url><loc>${new URL(p, site)}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
