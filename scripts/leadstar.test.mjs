import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProgram, normalizeCoupon, logoUrl, fetchLeadstar, LS_OFFSET } from './leadstar.mjs';

const allowed = ['uroda', 'dom i ogród'];
const prog = (o = {}) => ({ id: 3085, product_id: 30, product: 'uroda', institution: 'Annabelle Minerals', logo: '//img.leadmax.pl/logo/x.png', program_name: 'Sklep internetowy', only_mailing: 0, url: 'https://leadstar.pl/c?pid=1&tid=1&ha=1&r=2', dest_url: 'www.annabelleminerals.com', status: 1, ...o });
const coupon = (o = {}) => ({ id: 3085, coupon_id: 3, coupon_code: 'MINERALS5', coupon_descr: '5% rabatu na zakupy.&nbsp;Kod działa na cały asortyment.', coupon_date_from: '2020-02-12', coupon_date_to: '2099-12-31', url: 'https://leadstar.pl/c?pid=1&tid=1&ha=1&r=2', ...o });
const NOW = new Date('2026-10-28T12:00:00Z');

test('logoUrl: dokłada https do //host', () => {
  assert.equal(logoUrl('//img.leadmax.pl/logo/a.png'), 'https://img.leadmax.pl/logo/a.png');
  assert.equal(logoUrl(''), null);
});

test('normalizeProgram: zaakceptowany sklep z dozwolonej kategorii', () => {
  const { program } = normalizeProgram(prog(), { allowedProducts: allowed });
  assert.equal(program.programId, LS_OFFSET + 3085);
  assert.equal(program.name, 'Annabelle Minerals');
  assert.equal(program.logo, 'https://img.leadmax.pl/logo/x.png');
});

test('normalizeProgram: odrzuca niezaakceptowane, mailing, pożyczki, wykluczone', () => {
  const o = { allowedProducts: allowed, excludedIds: [7] };
  assert.equal(normalizeProgram(prog({ status: 0 }), o).reject, 'program niezaakceptowany');
  assert.equal(normalizeProgram(prog({ status: 2 }), o).reject, 'program niezaakceptowany');
  assert.equal(normalizeProgram(prog({ only_mailing: 1 }), o).reject, 'tylko mailing');
  assert.equal(normalizeProgram(prog({ product: 'pożyczka pozabankowa' }), o).reject, 'kategoria niedozwolona');
  assert.equal(normalizeProgram(prog({ product: 'erotyka' }), o).reject, 'kategoria niedozwolona');
  assert.equal(normalizeProgram(prog({ id: 7 }), o).reject, 'program wykluczony');
  assert.equal(normalizeProgram(prog({ url: '' }), o).reject, 'brak linku');
});

test('normalizeCoupon: kod, daty i opis', () => {
  const { program } = normalizeProgram(prog(), { allowedProducts: allowed });
  const { voucher } = normalizeCoupon(coupon(), program, NOW);
  assert.equal(voucher.id, 'ls-3');
  assert.equal(voucher.code, 'MINERALS5');
  assert.equal(voucher.programId, LS_OFFSET + 3085);
  assert.equal(voucher.validTo, '2099-12-31T23:59:59.000Z');
  assert.ok(voucher.text.startsWith('5% rabatu na zakupy.'));
  // brak dat ("0000-00-00") = null
  const v2 = normalizeCoupon(coupon({ coupon_date_from: '0000-00-00', coupon_date_to: '0000-00-00' }), program, NOW).voucher;
  assert.equal(v2.validTo, null);
  assert.equal(v2.validFrom, null);
});

test('normalizeCoupon: odrzuca wygasłe, przyszłe, bez kodu i bez zaakceptowanego programu', () => {
  const { program } = normalizeProgram(prog(), { allowedProducts: allowed });
  assert.equal(normalizeCoupon(coupon({ coupon_date_to: '2022-12-31' }), program, NOW).reject, 'wygasły');
  assert.equal(normalizeCoupon(coupon({ coupon_date_from: '2030-01-01' }), program, NOW).reject, 'jeszcze nieaktywny');
  assert.equal(normalizeCoupon(coupon({ coupon_code: 'zapis do newslettera' }), program, NOW).reject, 'brak poprawnego kodu');
  assert.equal(normalizeCoupon(coupon(), undefined, NOW).reject, 'program niedozwolony lub niezaakceptowany');
});

test('normalizeCoupon: pole końca ważności w wersji z literówką z dokumentacji (coupon_date_top)', () => {
  const { program } = normalizeProgram(prog(), { allowedProducts: allowed });
  const c = coupon(); delete c.coupon_date_to; c.coupon_date_top = '2022-01-01';
  assert.equal(normalizeCoupon(c, program, NOW).reject, 'wygasły');
});

test('fetchLeadstar: sklepy tylko z kodami, stronicowanie, filtry', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = new URLSearchParams(opts.body);
    calls.push(`${url.split('/api/')[1]}#${body.get('page')}`);
    assert.equal(body.get('partner_id'), '42');
    assert.equal(body.get('api_key'), 'KEY');
    const rows = url.endsWith('/programs')
      ? [prog(), prog({ id: 9, institution: 'Sklep bez kodu' }), prog({ id: 10, institution: 'Bank', product: 'konto osobiste' }), prog({ id: 11, institution: 'Nowy', status: 2 })]
      : [coupon(), coupon({ id: 9, coupon_id: 99, coupon_code: 'XX' }), coupon({ id: 10, coupon_id: 100, coupon_code: 'BANK10' })];
    return { ok: true, status: 200, text: async () => JSON.stringify({ info: { status: 'ok', rows_count: rows.length }, rows }) };
  };
  const out = await fetchLeadstar({ partnerId: 42, apiKey: 'KEY', base: 'http://x', config: { produktyDozwolone: allowed }, now: NOW, fetchImpl });
  // „Sklep bez kodu” ma tylko kod zbyt krótki, by być kodem → nie trafia na stronę
  assert.deepEqual(out.shops.map((s) => s.name), ['Annabelle Minerals']);
  assert.deepEqual(out.vouchers.map((v) => v.id), ['ls-3']);
  assert.equal(out.rejected.coupons['brak poprawnego kodu'], 1);
  assert.equal(out.rejected.coupons['program niedozwolony lub niezaakceptowany'], 1); // kod banku
  assert.deepEqual(calls, ['programs#0', 'coupons#0']);
});

test('fetchLeadstar: błąd autoryzacji (401) rzuca czytelny błąd bez ponawiania', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; return { ok: true, status: 200, text: async () => JSON.stringify({ info: { status: 'error', error_code: 401, error_msg: 'Unauthorized Request' } }) }; };
  await assert.rejects(fetchLeadstar({ partnerId: 1, apiKey: 'x', base: 'http://x', fetchImpl }), /Unauthorized Request/);
  assert.equal(n, 1);
});
