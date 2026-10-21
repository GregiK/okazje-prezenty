import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapArray, parsePrice, normalizeProduct, normalizeVoucher, slugify } from './normalize.mjs';

const base = {
  webeProductId: 'p1', productName: 'Wisiorek', productPrice: 80, priceCut: 20,
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

test('produkt: poprawny i stara cena z priceCut', () => {
  const { product } = normalizeProduct(base);
  assert.equal(product.oldPrice, 100);
  assert.equal(product.discount, 20);
  assert.equal(product.category, 'bizuteria');
});

test('produkt: odrzucenia', () => {
  assert.equal(normalizeProduct({ ...base, productPrice: 0 }).reject, 'cena');
  assert.equal(normalizeProduct({ ...base, productImages: { productImagesUrl: [] } }).reject, 'zdjęcie');
  assert.equal(normalizeProduct({ ...base, productTrackingUrl: '' }).reject, 'link');
  assert.equal(normalizeProduct({ ...base, shopCategoryName: 'Zabawki dla dzieci' }, { excludedWords: ['zabawk'] }).reject, 'kategoria wykluczona');
});

test('produkt: podejrzanie wysoka obniżka nie daje przekreślonej ceny', () => {
  const { product } = normalizeProduct({ ...base, priceCut: 95 });
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
