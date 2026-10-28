#!/usr/bin/env node
// Pobiera dane z API webePartners v3, normalizuje je i zapisuje do src/data/*.json.
// Tryby:
//   WEBE_LOGIN + WEBE_PASSWORD -> Basic Auth (GitHub Actions)
//   WEBE_PROXY_AUTH=1          -> zapytania bez nagłówka (proxy środowiska dokłada autoryzację)
//   brak env                   -> fixtures z katalogu fixtures/ (chyba że REQUIRE_LIVE=1 -> błąd)
// Opcjonalnie: PROGRAM_IDS=261,12223 nadpisuje listę z src/config/programs.json (testy).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pickPrograms } from './programs.mjs';
import { fetchLeadstar } from './leadstar.mjs';
import { capProducts, normalizeProduct, normalizeVoucher, unwrapArray, slugify, isHttpUrl, matchCategory, feedLastUpdate } from './normalize.mjs';

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

// REQUIRE_LIVE=1 (ustawiane w CI): brak danych logowania ma przerwać build zamiast po cichu użyć fixtures.
if (process.env.REQUIRE_LIVE === '1' && mode === 'fixtures') {
  console.error('[fetch-data] BŁĄD: REQUIRE_LIVE=1, ale brak WEBE_LOGIN/WEBE_PASSWORD — nie wdrażam danych z fixtures');
  process.exit(1);
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
      if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
      const text = await res.text();
      return text.trim() ? JSON.parse(text) : [];
    } catch (e) {
      lastErr = e;
      if (e.status >= 400 && e.status < 500) break; // błąd klienta (np. brak programu) — nie ponawiamy
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  const fail = new Error(`${pathAndQuery}: ${lastErr.message}`);
  fail.status = lastErr.status;
  throw fail;
}

const dateStr = (d) => d.toISOString().slice(0, 10);

async function load(name, livePath) {
  if (mode === 'fixtures') return unwrapArray(await readJson(path.join(ROOT, 'fixtures', `${name}.json`)));
  return unwrapArray(await api(livePath));
}

async function main() {
  const config = await readJson(path.join(ROOT, 'src/config/programs.json'));
  const envIds = process.env.PROGRAM_IDS?.split(',').map((s) => Number(s.trim())).filter(Boolean);
  const excluded = config.wykluczoneKategorie ?? [];
  const excludedPhrases = config.wykluczoneFrazy ?? [];
  const excludedNameRegex = config.wykluczoneNazwy ?? [];
  const excludedNameWords = config.wykluczoneSlowaWNazwie ?? [];
  const now = new Date();
  const maxFeedAgeDays = config.maxWiekFeeduDni ?? 150;
  // --- GetPrograms
  const allPrograms = await load('GetPrograms', '/Wydawca/GetPrograms');
  const programById = new Map(allPrograms.map((p) => [Number(p.programId), p]));

  // --- dobór sklepów: ręczne (tylko zaakceptowane) + automatycznie wykryte nowe
  let configured, skipped = [], added = [];
  if (envIds) { // tryb testowy: dokładnie wskazane ID, bez kontroli statusu i bez auto
    configured = envIds.map((id) => config.programs.concat(config.oczekujace ?? []).find((p) => p.programId === id) ?? { programId: id, name: String(id) });
  } else {
    ({ configured, skipped, added } = pickPrograms(config, allPrograms, { auto: mode !== 'fixtures' }));
  }
  const ids = new Set(configured.map((p) => p.programId));
  log(`tryb: ${mode}, sklepów do pobrania: ${ids.size} (automatycznie dodane: ${added.length}, pominięte: ${skipped.length})`);
  skipped.forEach((x) => log(`POMINIĘTO ${x.name} (${x.programId}): ${x.reason}`));
  added.forEach((x) => log(`NOWY SKLEP (auto) ${x.name} (${x.programId})`));

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
        // martwy feed (sklep przestał aktualizować ofertę → webePartners odsyła klienta na „sklep niedostępny”)
        const last = feedLastUpdate(part);
        if (last && now - last > maxFeedAgeDays * 864e5) {
          const name = configured.find((p) => p.programId === id)?.name ?? String(id);
          skipped.push({ programId: id, name, reason: `nieaktualny feed (ostatnia zmiana cen ${dateStr(last)})` });
          log(`POMINIĘTO ${name} (${id}): nieaktualny feed (ostatnia zmiana cen ${dateStr(last)})`);
          ids.delete(id);
          continue;
        }
        rawProducts.push(...part);
      } catch (e) {
        // 4xx = program bez feedu (np. zakończony) => traktujemy jak pusty; błąd sieci/serwera (5xx) przerywa build,
        // żeby nie opublikować niepełnej oferty — na serwerze zostaje wczorajsza wersja.
        if (e.status >= 400 && e.status < 500) log(`GetHotPrice programId=${id}: ${e.message} — pomijam program`);
        else throw new Error(`GetHotPrice programId=${id}: ${e.message}`);
      }
    }
  }

  configured = configured.filter((c) => ids.has(c.programId));

  // --- GetVouchers
  const from = new Date(now.getTime() - 365 * 864e5);
  const to = new Date(now.getTime() + 365 * 864e5);
  const rawVouchers = await load('GetVouchers', `/Wydawca/GetVouchers?dateFrom=${dateStr(from)}&dateTo=${dateStr(to)}`);

  // --- LeadStar (opcjonalnie): zaakceptowane programy sklepowe + aktualne kody. Błąd nie blokuje wdrożenia
  // (oferta webePartners jest kompletna), ale kody LeadStar znikną do następnej aktualizacji — widać to w logu.
  let lsShops = [], lsVouchers = [], lsInfo = { status: 'wyłączony' };
  // przycinamy białe znaki (częsty błąd przy wklejaniu sekretów: spacja albo nowa linia na końcu)
  const lsPartner = process.env.LEADSTAR_PARTNER_ID?.trim(), lsKey = process.env.LEADSTAR_API_KEY?.trim();
  if (config.leadstar?.wlaczone && mode !== 'fixtures') {
    if (!lsPartner || !lsKey) {
      lsInfo = { status: 'brak LEADSTAR_PARTNER_ID / LEADSTAR_API_KEY' };
      log('LeadStar: brak kluczy API — pomijam');
    } else {
      // diagnostyka bez ujawniania klucza: ID partnera to liczba (nie login/e-mail), klucz pokazujemy tylko jako długość
      log(`LeadStar: partner_id=${lsPartner} (${/^\d+$/.test(lsPartner) ? 'liczba, OK' : 'UWAGA: to nie jest liczba — wpisz ID z panelu, nie login'}), klucz API: ${lsKey.length} znaków`);
      try {
        const ls = await fetchLeadstar({ partnerId: lsPartner, apiKey: lsKey, base: process.env.LEADSTAR_API ?? 'https://leadstar.pl', config: config.leadstar, now });
        lsShops = ls.shops; lsVouchers = ls.vouchers;
        lsInfo = { status: 'ok', programs: ls.counts.programs, coupons: ls.counts.coupons, shops: ls.shops.length, vouchers: ls.vouchers.length, rejected: ls.rejected };
        log(`LeadStar: programów ${ls.counts.programs}, kodów ${ls.counts.coupons} → sklepów ${ls.shops.length}, kodów ${ls.vouchers.length}`);
      } catch (e) {
        lsInfo = { status: 'błąd', error: e.message };
        log(`LeadStar: BŁĄD (${e.message}) — kody LeadStar pominięte w tej aktualizacji`);
      }
    }
  }

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
      category: matchCategory(p?.categoryName ?? ''),
      auto: c.auto === true
    };
  });
  for (const l of lsShops) {
    shops.push({ programId: l.programId, slug: slugify(l.name), name: l.name, logo: l.logo, url: l.url, accepted: true, category: l.category, auto: false, network: 'leadstar' });
  }
  const shopById = new Map(shops.map((s) => [s.programId, s]));

  // --- produkty
  const rejects = {};
  const seen = new Set();
  const products = [];
  for (const raw of rawProducts) {
    const pid = Number(raw.programId);
    if (!ids.has(pid)) continue;
    const res = normalizeProduct(raw, { excludedWords: excluded, excludedPhrases, excludedNameRegex, excludedNameWords, now });
    if (res.reject) {
      rejects[res.reject] = (rejects[res.reject] ?? 0) + 1;
      continue;
    }
    if (seen.has(res.product.id)) continue;
    seen.add(res.product.id);
    products.push(res.product);
  }
  // limit produktów na sklep (duże feedy, np. 2000 pozycji, przycinamy do różnorodnego wyboru)
  const cap = config.maxProduktowNaSklep ?? 150;
  const capped = [];
  for (const sh of shops) {
    const mine = products.filter((p) => p.programId === sh.programId);
    const kept = capProducts(mine, cap, { targetPrice: config.idealnaCenaPrezentu ?? 150 });
    if (kept.length < mine.length) log(`${sh.name}: ${mine.length} produktów → limit ${kept.length}`);
    capped.push(...kept);
  }
  products.length = 0;
  products.push(...capped);
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
  vouchers.push(...lsVouchers);
  vouchers.sort((a, b) => (a.validTo ?? '9') .localeCompare(b.validTo ?? '9'));

  const perShop = shops.map((sh) => ({
    programId: sh.programId,
    name: sh.name,
    auto: sh.auto,
    products: products.filter((p) => p.programId === sh.programId).length,
    vouchers: vouchers.filter((v) => v.programId === sh.programId).length
  }));
  const meta = {
    updatedAt: now.toISOString(),
    mode,
    counts: { shops: shops.length, products: products.length, vouchers: vouchers.length },
    perShop,
    added: added.map((x) => x.name),
    skipped,
    leadstar: lsInfo,
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
  // Podsumowanie oferty w logu GitHub Actions (zakładka Summary przebiegu).
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    const rows = perShop.map((x) => `| ${x.name}${x.auto ? ' 🆕 (auto)' : ''} | ${x.products} | ${x.vouchers} |`).join('\n');
    const extra = [
      added.length ? `**Nowe sklepy dodane automatycznie:** ${added.map((x) => x.name).join(', ')}` : '',
      skipped.length ? `**Pominięte programy:** ${skipped.map((x) => `${x.name} (${x.reason})`).join('; ')}` : ''
    ].filter(Boolean).join('\n\n');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Oferta serwisu\n\n| Sklep | Produkty | Kody |\n|---|---|---|\n${rows}\n\nRazem: ${products.length} produktów, ${vouchers.length} kodów.\n\n${extra}\n`);
  }
  if (mode !== 'fixtures' && products.length === 0 && vouchers.length === 0) {
    throw new Error('API zwróciło puste dane — przerywam, aby nie opublikować pustej strony');
  }
}

main().catch((e) => {
  console.error('[fetch-data] BŁĄD:', e.message);
  process.exit(1);
});
