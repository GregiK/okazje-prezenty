#!/usr/bin/env node
// Pobiera dane z API webePartners v3, normalizuje je i zapisuje do src/data/*.json.
// Tryby:
//   WEBE_LOGIN + WEBE_PASSWORD -> Basic Auth (GitHub Actions)
//   WEBE_PROXY_AUTH=1          -> zapytania bez nagłówka (proxy środowiska dokłada autoryzację)
//   brak env                   -> fixtures z katalogu fixtures/
// Opcjonalnie: PROGRAM_IDS=261,12223 nadpisuje listę z src/config/programs.json (testy).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeProduct, normalizeVoucher, unwrapArray, slugify, isHttpUrl, matchCategory } from './normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api2.webepartners.pl';
const OUT = path.join(ROOT, 'src/data');

const mode = process.env.WEBE_LOGIN && process.env.WEBE_PASSWORD ? 'basic' : process.env.WEBE_PROXY_AUTH === '1' ? 'proxy' : 'fixtures';
// Node nie używa proxy z env domyślnie — w trybie proxy uruchom się ponownie z NODE_USE_ENV_PROXY=1.
if (mode === 'proxy' && process.env.NODE_USE_ENV_PROXY !== '1') {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' }
  });
  process.exit(r.status ?? 1);
}

const log = (...a) => console.log('[fetch-data]', ...a);
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

async function api(pathAndQuery) {
  const headers = { Accept: 'application/json' };
  if (mode === 'basic') {
    headers.Authorization = 'Basic ' + Buffer.from(`${process.env.WEBE_LOGIN}:${process.env.WEBE_PASSWORD}`).toString('base64');
  }
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(API + pathAndQuery, { headers, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return text.trim() ? JSON.parse(text) : [];
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`${pathAndQuery}: ${lastErr.message}`);
}

const dateStr = (d) => d.toISOString().slice(0, 10);

async function load(name, livePath) {
  if (mode === 'fixtures') return unwrapArray(await readJson(path.join(ROOT, 'fixtures', `${name}.json`)));
  return unwrapArray(await api(livePath));
}

async function main() {
  const config = await readJson(path.join(ROOT, 'src/config/programs.json'));
  const envIds = process.env.PROGRAM_IDS?.split(',').map((s) => Number(s.trim())).filter(Boolean);
  const configured = envIds
    ? envIds.map((id) => config.programs.concat(config.oczekujace ?? []).find((p) => p.programId === id) ?? { programId: id, name: String(id) })
    : config.programs;
  const ids = new Set(configured.map((p) => p.programId));
  const excluded = config.wykluczoneKategorie ?? [];
  const now = new Date();
  log(`tryb: ${mode}, programów w konfiguracji: ${ids.size}`);

  // --- GetPrograms
  const allPrograms = await load('GetPrograms', '/Wydawca/GetPrograms');
  const programById = new Map(allPrograms.map((p) => [Number(p.programId), p]));

  // --- GetHotPrice: bez programId zwraca tylko pierwsze ~2000 pozycji (dominują sklepy spoza konfiguracji),
  // dlatego dla każdego programu z konfiguracji pobieramy osobno.
  let rawProducts = [];
  if (mode === 'fixtures') {
    rawProducts = await load('GetHotPrice', '');
  } else {
    for (const id of ids) {
      try {
        const part = unwrapArray(await api(`/Wydawca/GetHotPrice?programId=${id}`));
        log(`GetHotPrice programId=${id}: ${part.length}`);
        rawProducts.push(...part);
      } catch (e) {
        log(`UWAGA GetHotPrice programId=${id}: ${e.message}`);
      }
    }
  }

  // --- GetVouchers
  const from = new Date(now.getTime() - 365 * 864e5);
  const to = new Date(now.getTime() + 365 * 864e5);
  const rawVouchers = await load('GetVouchers', `/Wydawca/GetVouchers?dateFrom=${dateStr(from)}&dateTo=${dateStr(to)}`);

  // --- sklepy
  const shops = configured.map((c) => {
    const p = programById.get(c.programId);
    const sample = rawProducts.find((r) => Number(r.programId) === c.programId);
    const name = (p?.programName ?? sample?.programName ?? c.name).replace(/\s+\d+%?$/, '').trim();
    return {
      programId: c.programId,
      slug: slugify(name),
      name,
      logo: [p?.programLogoUrl, sample?.programLogoUrl].find(isHttpUrl) ?? null,
      url: isHttpUrl(p?.programUrl) ? p.programUrl : null,
      accepted: p ? p.relationId === 4 : null,
      category: matchCategory(p?.categoryName ?? '')
    };
  });
  const shopById = new Map(shops.map((s) => [s.programId, s]));

  // --- produkty
  const rejects = {};
  const seen = new Set();
  const products = [];
  for (const raw of rawProducts) {
    const pid = Number(raw.programId);
    if (!ids.has(pid)) continue;
    const res = normalizeProduct(raw, { excludedWords: excluded });
    if (res.reject) {
      rejects[res.reject] = (rejects[res.reject] ?? 0) + 1;
      continue;
    }
    if (seen.has(res.product.id)) continue;
    seen.add(res.product.id);
    products.push(res.product);
  }
  products.sort((a, b) => b.discount - a.discount || a.price - b.price);

  // --- kody
  const vReject = {};
  const vSeen = new Set();
  const vouchers = [];
  for (const raw of rawVouchers) {
    if (!ids.has(Number(raw.programId))) continue;
    const res = normalizeVoucher(raw, now);
    if (res.reject) {
      vReject[res.reject] = (vReject[res.reject] ?? 0) + 1;
      continue;
    }
    if (vSeen.has(res.voucher.id)) continue;
    vSeen.add(res.voucher.id);
    vouchers.push(res.voucher);
  }
  vouchers.sort((a, b) => (a.validTo ?? '9') .localeCompare(b.validTo ?? '9'));

  const meta = {
    updatedAt: now.toISOString(),
    mode,
    counts: { shops: shops.length, products: products.length, vouchers: vouchers.length },
    rejected: { products: rejects, vouchers: vReject }
  };

  await mkdir(OUT, { recursive: true });
  await Promise.all([
    writeFile(path.join(OUT, 'shops.json'), JSON.stringify(shops, null, 1)),
    writeFile(path.join(OUT, 'products.json'), JSON.stringify(products)),
    writeFile(path.join(OUT, 'vouchers.json'), JSON.stringify(vouchers, null, 1)),
    writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1))
  ]);
  log(`zapisano: ${products.length} produktów, ${vouchers.length} kodów, ${shops.length} sklepów`);
  log('odrzucone:', JSON.stringify(meta.rejected));
  if (mode !== 'fixtures' && products.length === 0 && vouchers.length === 0) {
    throw new Error('API zwróciło puste dane — przerywam, aby nie opublikować pustej strony');
  }
}

main().catch((e) => {
  console.error('[fetch-data] BŁĄD:', e.message);
  process.exit(1);
});
