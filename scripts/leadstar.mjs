// Integracja z API LeadStar.pl (https://leadstar.pl/api/*; dokumentacja API_LeadStar_0.4.4).
// Zwraca zaakceptowane programy sklepowe i aktualne kody rabatowe w tym samym formacie co dane webePartners.
// LeadStar nie udostępnia produktów z cenami — tylko programy (kampanie) i kody, więc produktów stąd nie ma.
import { matchCategory, stripHtml } from './normalize.mjs';

/** Przesunięcie ID programów LeadStar, żeby nie kolidowały z ID webePartners (te są < 1 000 000). */
export const LS_OFFSET = 1_000_000;
export const ACTIVE = 1; // status „aktywny” (zapisany i zaakceptowany) w API LeadStar

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** Logo z API ma postać „//img.leadmax.pl/…” — dokładamy https. */
export function logoUrl(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  return v.startsWith('//') ? 'https:' + v : /^https?:\/\//i.test(v) ? v : null;
}

/** Data z API (RRRR-MM-DD lub „0000-00-00” = brak) → ISO albo null. Koniec ważności włącznie → koniec dnia. */
function apiDate(value, endOfDay = false) {
  const v = String(value ?? '').trim();
  if (!v || v.startsWith('0000')) return null;
  const d = new Date(v + (endOfDay ? 'T23:59:59Z' : 'T00:00:00Z'));
  return isNaN(d) ? null : d.toISOString();
}

/**
 * Program LeadStar → sklep. Odrzucamy: niezaakceptowane (status ≠ 1), tylko-mailingowe, bez linku,
 * kategorie spoza listy dozwolonych (pożyczki, banki, moda/odzież, erotyka, dziecko…) i wykluczone programy.
 */
export function normalizeProgram(row, { allowedProducts = [], excludedIds = [] } = {}) {
  const id = Number(row?.id);
  if (!id) return { reject: 'brak id' };
  if (excludedIds.includes(id)) return { reject: 'program wykluczony' };
  if (Number(row.status) !== ACTIVE) return { reject: 'program niezaakceptowany' };
  if (Number(row.only_mailing) === 1) return { reject: 'tylko mailing' };
  const url = String(row.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return { reject: 'brak linku' };
  if (!allowedProducts.map(norm).includes(norm(row.product))) return { reject: 'kategoria niedozwolona' };
  const name = String(row.institution ?? '').trim();
  if (!name) return { reject: 'brak nazwy' };
  return {
    program: {
      lsId: id,
      programId: LS_OFFSET + id,
      name,
      logo: logoUrl(row.logo),
      url,
      domain: String(row.dest_url ?? '').trim() || null,
      category: matchCategory(row.product, name),
      product: row.product
    }
  };
}

/** Kod rabatowy LeadStar → kupon w formacie serwisu. */
export function normalizeCoupon(row, program, now = new Date()) {
  if (!program) return { reject: 'program niedozwolony lub niezaakceptowany' };
  const rawCode = String(row?.coupon_code ?? '').trim();
  if (!/^[\p{L}\p{N}_\-!%.]{3,40}$/u.test(rawCode)) return { reject: 'brak poprawnego kodu' };
  // w dokumentacji pole końca ważności ma dwie nazwy (coupon_date_top / coupon_date_to)
  const to = apiDate(row.coupon_date_to ?? row.coupon_date_top, true);
  const from = apiDate(row.coupon_date_from);
  if (to && new Date(to) < now) return { reject: 'wygasły' };
  if (from && new Date(from) > now) return { reject: 'jeszcze nieaktywny' };
  const url = String(row.url ?? '').trim() || program.url;
  if (!/^https?:\/\//i.test(url)) return { reject: 'brak linku' };
  const text = stripHtml(row.coupon_descr, 280);
  return {
    voucher: {
      id: `ls-${row.coupon_id ?? `${program.lsId}-${rawCode}`}`,
      title: `Kod rabatowy ${program.name}`,
      text,
      code: rawCode,
      type: 'Kod rabatowy',
      programId: program.programId,
      validFrom: from,
      validTo: to,
      url,
      category: program.category
    }
  };
}

/** POST do API LeadStar (parametry jako formularz), z ponawianiem i stronicowaniem (page od 0). */
export async function callApi(base, endpoint, { partnerId, apiKey }, { fetchImpl = fetch, perPage = 200, maxPages = 50 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const body = new URLSearchParams({ partner_id: String(partnerId), api_key: apiKey, per_page: String(perPage), page: String(page) });
    let json, lastErr;
    for (let attempt = 1; attempt <= 3 && !json; attempt++) {
      try {
        const res = await fetchImpl(`${base}/api/${endpoint}`, { method: 'POST', body, headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
        const text = await res.text();
        if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
        json = JSON.parse(text);
        if (json?.info?.status && json.info.status !== 'ok') { const e = new Error(`${json.info.error_code ?? ''} ${json.info.error_msg ?? 'błąd API'}`.trim()); e.status = json.info.error_code; throw e; }
      } catch (e) {
        lastErr = e; json = undefined;
        if (e.status >= 400 && e.status < 500) break; // błąd autoryzacji/parametrów — nie ponawiamy
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (!json) throw new Error(`LeadStar ${endpoint}: ${lastErr?.message ?? 'brak odpowiedzi'}`);
    const part = Array.isArray(json.rows) ? json.rows : [];
    rows.push(...part);
    const total = Number(json.info?.rows_count);
    if (part.length === 0 || part.length < perPage || (total && rows.length >= total)) break;
  }
  return rows;
}

/**
 * Pobiera i normalizuje: zaakceptowane programy sklepowe + ich aktualne kody.
 * Zwraca { shops, vouchers, rejected } — sklepy tylko te, które mają co najmniej jeden kod
 * (sam link do sklepu bez treści to cienka strona partnerska).
 */
export async function fetchLeadstar({ partnerId, apiKey, base = 'https://leadstar.pl', config = {}, now = new Date(), fetchImpl }) {
  const creds = { partnerId, apiKey };
  const programRows = await callApi(base, 'programs', creds, { fetchImpl });
  const couponRows = await callApi(base, 'coupons', creds, { fetchImpl });
  const rejected = { programs: {}, coupons: {} };
  const bump = (bucket, why) => { bucket[why] = (bucket[why] ?? 0) + 1; };
  const programs = new Map();
  for (const row of programRows) {
    const res = normalizeProgram(row, { allowedProducts: config.produktyDozwolone ?? [], excludedIds: config.wykluczoneProgramy ?? [] });
    if (res.reject) { bump(rejected.programs, res.reject); continue; }
    programs.set(res.program.lsId, res.program);
  }
  const vouchers = [];
  const seen = new Set();
  for (const row of couponRows) {
    const res = normalizeCoupon(row, programs.get(Number(row.id)), now);
    if (res.reject) { bump(rejected.coupons, res.reject); continue; }
    if (seen.has(res.voucher.id)) continue;
    seen.add(res.voucher.id);
    vouchers.push(res.voucher);
  }
  const withCoupons = new Set(vouchers.map((v) => v.programId));
  const shops = [...programs.values()].filter((p) => withCoupons.has(p.programId));
  return { shops, vouchers, rejected, counts: { programs: programRows.length, coupons: couponRows.length } };
}
