import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapArray, parsePrice, normalizeProduct, normalizeVoucher, slugify, computeDeal } from './normalize.mjs';

const base = {
  webeProductId: 'p1', productName: 'Wisiorek', productPrice: 80, priceCut: 20,
  previousPrice: [{ createDate: '2026-08-01T00:00:00Z', price: 100 }, { createDate: '2026-10-10T00:00:00Z', price: 80 }],
  productImages: { productImagesUrl: ['https://img/x.jpg'], productThumbUrl: 'https://img/t.jpg' },
  productTrackingUrl: 'https://webep1.com/c/1?r=abc', programId: 1, category: { webeCategoryName: ['Biżuteria > Naszyjniki'] }
};

test('unwrapArray obsługuje tablicę i obiekt z polem', () => {
  assert.deepEqual(unwrapArray([1]), [1]);
  assert.deepEqual(unwrapArray({ data: [2] }), [2]);
  assert.deepEqual(unwrapArray({ items: [3] }), [3]);
  assert.deepEqual(unwrapArray({ result: [4] }), [4]);
  assert.deepEqual(unwrapArray(null), []);
});

test('parsePrice: liczba i string z przecinkiem', () => {
  assert.equal(parsePrice(12.5), 12.5);
  assert.equal(parsePrice('1 299,90'), 1299.9);
  assert.ok(Number.isNaN(parsePrice(null)));
});

const NOW = new Date('2026-10-22T12:00:00Z');

test('produkt: świeża obniżka — cena odniesienia z historii, nie z priceCut', () => {
  const { product } = normalizeProduct(base, { now: NOW });
  assert.equal(product.oldPrice, 100);
  assert.equal(product.discount, 20);
  assert.equal(product.dealSince, '2026-10-10T00:00:00.000Z');
  assert.equal(product.category, 'bizuteria');
});

test('Omnibus: odniesienie = najniższa cena z 30 dni przed obniżką', () => {
  const prev = [
    { createDate: '2026-08-20T00:00:00Z', price: 120 },
    { createDate: '2026-09-20T00:00:00Z', price: 90 },
    { createDate: '2026-10-10T00:00:00Z', price: 80 }
  ];
  assert.equal(computeDeal(80, prev, NOW).reference, 90);
});

test('Omnibus: obniżka starsza niż 30 dni, podwyżka albo brak historii => brak znaczka', () => {
  const old = [{ createDate: '2024-01-01T00:00:00Z', price: 100 }, { createDate: '2025-02-01T00:00:00Z', price: 80 }];
  assert.equal(computeDeal(80, old, NOW), null);
  const up = [{ createDate: '2026-09-01T00:00:00Z', price: 60 }, { createDate: '2026-10-10T00:00:00Z', price: 80 }];
  assert.equal(computeDeal(80, up, NOW), null);
  assert.equal(computeDeal(80, undefined, NOW), null);
  assert.equal(computeDeal(80, [{ createDate: '2026-10-10T00:00:00Z', price: 80 }], NOW), null);
  const notEnding = [{ createDate: '2026-08-01T00:00:00Z', price: 100 }, { createDate: '2026-10-10T00:00:00Z', price: 70 }];
  assert.equal(computeDeal(80, notEnding, NOW), null);
});

test('produkt: galeria — duplikaty usuwane, max 8, pierwsze zdjęcie = image', () => {
  const urls = Array.from({ length: 12 }, (_, i) => `https://img/${i % 10}.jpg`);
  const { product } = normalizeProduct({ ...base, productImages: { productImagesUrl: urls } });
  assert.equal(product.images.length, 8);
  assert.equal(product.image, 'https://img/0.jpg');
  assert.equal(new Set(product.images).size, product.images.length);
});

test('produkt: odrzucenia', () => {
  assert.equal(normalizeProduct({ ...base, productPrice: 0 }).reject, 'cena');
  assert.equal(normalizeProduct({ ...base, productImages: { productImagesUrl: [] } }).reject, 'zdjęcie');
  assert.equal(normalizeProduct({ ...base, productTrackingUrl: '' }).reject, 'link');
  assert.equal(normalizeProduct({ ...base, shopCategoryName: 'Zabawki dla dzieci' }, { excludedWords: ['zabawk'] }).reject, 'kategoria wykluczona');
});

test('produkt: podejrzanie wysoka obniżka nie daje przekreślonej ceny', () => {
  const huge = [{ createDate: '2026-08-01T00:00:00Z', price: 1000 }, { createDate: '2026-10-10T00:00:00Z', price: 80 }];
  const { product } = normalizeProduct({ ...base, previousPrice: huge }, { now: NOW });
  assert.equal(product.oldPrice, null);
  assert.equal(product.discount, 0);
});

test('kod: po terminie odrzucony, kod bez spacji zachowany', () => {
  const v = { voucherId: 'v', voucherName: 'Test', voucherCode: 'ABC10', voucherTrackingUrl: 'https://webep1.com/c/1', programId: 1 };
  assert.equal(normalizeVoucher({ ...v, dateTo: '2020-01-01T00:00:00Z' }).reject, 'po terminie');
  assert.equal(normalizeVoucher({ ...v, dateTo: '2099-01-01T00:00:00Z' }).voucher.code, 'ABC10');
  assert.equal(normalizeVoucher({ ...v, voucherCode: 'zapis do newslettera' }).voucher.code, null);
});

test('slugify', () => assert.equal(slugify('Żółć & Cup'), 'zolc-i-cup'));
