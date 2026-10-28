import test from 'node:test';
import assert from 'node:assert/strict';
import { feedId, tag, parseProduct, productChunks, processFeed, toRaw, FEED_OFFSET } from './productfeed.mjs';

const item = (o = {}) => `<product>
  <id><![CDATA[${o.id ?? 'A1'}]]></id>
  <product_url><![CDATA[${o.url ?? 'https://productfeed.pl/c?pid=1&tid=2&pfprdid=A1'}]]></product_url>
  <image_url><![CDATA[${o.image ?? 'https://cdn.example.com/a.jpg'}]]></image_url>
  <name><![CDATA[${o.name ?? 'Marka Woda perfumowana 50 ml'}]]></name>
  <description><![CDATA[${o.description ?? 'Piękny zapach.'}]]></description>
  <price>${o.price ?? '99.00'}</price>
  <old_price>199.00</old_price>
  <manufacturer><![CDATA[${o.brand ?? 'Marka'}]]></manufacturer>
  <is_promo>1</is_promo>
  <stock><![CDATA[${o.stock ?? 'in stock'}]]></stock>
</product>`;
const xml = (...items) => `<?xml version="1.0"?>\n<products>\n${items.join('\n')}\n</products>`;
async function* chunked(text, size) { const b = Buffer.from(text, 'utf8'); for (let i = 0; i < b.length; i += size) yield b.subarray(i, i + size); }
const rules = { excludedWords: ['dzieci'], excludedPhrases: ['zamiennik', 'inspirowan'], excludedNameWords: ['dla dzieci', 'podpask'] };

test('feedId: fid z adresu', () => {
  assert.equal(feedId('https://productfeed.pl/feed?pid=1&fid=466&ha=2'), 466);
  assert.equal(feedId('https://x.pl/feed?pid=1'), null);
  assert.equal(feedId('nie-url'), null);
});

test('tag/parseProduct: CDATA i zwykły tekst z encjami', () => {
  assert.equal(tag('<a><![CDATA[x & <y>]]></a>', 'a'), 'x & <y>');
  assert.equal(tag('<a>Tom &amp; Jerry &#243;</a>', 'a'), 'Tom & Jerry ó');
  assert.equal(tag('<a></a>', 'a'), '');
  assert.equal(tag('<a>1</a>', 'b'), null);
  const p = parseProduct(item());
  assert.equal(p.id, 'A1'); assert.equal(p.price, '99.00'); assert.equal(p.brand, 'Marka'); assert.equal(p.stock, 'in stock');
});

test('productChunks: dzieli strumień także gdy granica kawałka wypada w środku produktu lub znaku UTF-8', async () => {
  const text = xml(item({ id: 'A', name: 'Żółć perfumy 50 ml' }), item({ id: 'B' }), item({ id: 'C' }));
  for (const size of [1, 7, 64, 1000]) {
    const out = [];
    for await (const c of productChunks(chunked(text, size))) out.push(parseProduct(c));
    assert.deepEqual(out.map((p) => p.id), ['A', 'B', 'C'], `rozmiar kawałka ${size}`);
    assert.equal(out[0].name, 'Żółć perfumy 50 ml');
  }
});

test('processFeed: reguły wykluczeń, dostępność, cena minimalna, brak znaczka obniżki, kategoria wymuszona', async () => {
  const text = xml(
    item({ id: '1' }),
    item({ id: '2', name: 'Krem dla dzieci 50 ml' }),
    item({ id: '3', description: 'Doskonały zamiennik znanych perfum' }),
    item({ id: '4', stock: 'out of stock' }),
    item({ id: '5', price: '5.00' }),
    item({ id: '6', name: 'Podpaski Always', price: '30.00' }),
    item({ id: '7', image: '' })
  );
  const r = await processFeed(chunked(text, 500), 466, { rules, minPrice: 20, category: 'perfumy-uroda' });
  assert.deepEqual(r.products.map((p) => p.name), ['Marka Woda perfumowana 50 ml']);
  const p = r.products[0];
  assert.equal(p.programId, FEED_OFFSET + 466);
  assert.equal(p.discount, 0); assert.equal(p.oldPrice, null); // old_price i is_promo ze sklepu ignorujemy (Omnibus)
  assert.equal(p.category, 'perfumy-uroda');
  assert.match(p.id, /^[0-9a-f]{40}$/);
  assert.equal(r.stats.total, 7);
  assert.equal(r.stats.rejected['niedostępny'], 1);
  assert.equal(r.stats.rejected['cena poniżej minimum'], 1);
  assert.equal(toRaw(parseProduct(item({ id: '1' })), 466).webeProductId, p.id); // stabilne ID
});

test('processFeed: limit, przedziały cen i limit produktów z jednej marki', async () => {
  const items = [];
  for (let i = 0; i < 60; i++) items.push(item({ id: `L${i}`, name: `Marka${i % 10} Zestaw ${i} zapach`, brand: `M${i % 10}`, price: String(25 + i * 8) }));
  const r = await processFeed(chunked(xml(...items), 4096), 1, { rules, cap: 20, perBrand: 2 });
  assert.equal(r.products.length, 20);
  const perBrand = {}; for (const p of r.products) perBrand[p.brand] = (perBrand[p.brand] ?? 0) + 1;
  assert.ok(Object.values(perBrand).every((n) => n <= 2 + 1), JSON.stringify(perBrand)); // przedziały cen liczą limit osobno
  const prices = r.products.map((p) => p.price);
  assert.ok(Math.min(...prices) < 100 && Math.max(...prices) > 200, 'ceny z różnych półek');
  // deterministyczne: ten sam feed → ten sam wynik
  const r2 = await processFeed(chunked(xml(...items), 777), 1, { rules, cap: 20, perBrand: 2 });
  assert.deepEqual(r2.products.map((p) => p.id), r.products.map((p) => p.id));
});
