// Publiczny feed okazji dla automatyzacji (n8n: posty z okazjami na Facebooka).
// Linki są „surowe” (bez param1/param2) — n8n sam dokleja znacznik źródła, np. param1=fb.
import { productsByDiscount, vouchers, shopById, meta } from '../../lib/data.mjs';
import { SITE_NAME } from '../../config/site.mjs';

export function GET({ site }: { site: URL }) {
  const shopName = (id: number) => shopById.get(id)?.name ?? '';
  const body = {
    site: SITE_NAME,
    siteUrl: new URL('/', site).toString(),
    updatedAt: meta.updatedAt,
    shops: (meta.perShop ?? []).map((x) => ({ programId: x.programId, name: x.name, products: x.products, vouchers: x.vouchers, auto: !!x.auto })),
    products: productsByDiscount.map((p) => ({
      id: p.id,
      name: p.name,
      shop: shopName(p.programId),
      programId: p.programId,
      category: p.category,
      price: p.price,
      oldPrice: p.oldPrice ?? null,
      discount: p.discount ?? 0,
      image: p.image,
      url: p.url
    })),
    vouchers: vouchers.map((v) => ({
      id: v.id,
      title: v.title,
      code: v.code,
      shop: shopName(v.programId),
      programId: v.programId,
      validTo: v.validTo,
      url: v.url
    }))
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
