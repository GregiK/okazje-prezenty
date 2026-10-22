// Dobór programów (sklepów) do pokazania — czysta funkcja, bez I/O.
// Zasady:
//  1) programy ręczne z `programs` pokazujemy tylko, gdy w GetPrograms mają relationId=4 (zaakceptowany);
//  2) opcjonalnie `automatyczne`: nowo zaakceptowane programy z feedem (isXml) i dozwoloną kategorią
//     są dodawane same (bez ręcznej edycji pliku), o ile nie są wykluczone po ID ani po kategorii.

const norm = (s) => String(s ?? '').toLowerCase();
const matches = (text, words) => words.some((w) => norm(text).includes(norm(w)));

export const ACCEPTED = 4;

/**
 * @param config      zawartość src/config/programs.json
 * @param allPrograms odpowiedź GetPrograms (tablica)
 * @param opts        { auto: bool } — czy włączać automatyczne dodawanie (false w testach/fixtures)
 * @returns { configured: [{programId,name,auto?}], skipped: [{programId,name,reason}], added: [...] }
 */
export function pickPrograms(config, allPrograms, { auto = true } = {}) {
  const byId = new Map(allPrograms.map((p) => [Number(p.programId), p]));
  const configured = [];
  const skipped = [];
  const added = [];
  const seen = new Set();

  for (const c of config.programs ?? []) {
    const p = byId.get(c.programId);
    if (!p) {
      skipped.push({ programId: c.programId, name: c.name, reason: 'brak programu w GetPrograms (zakończony lub usunięty)' });
    } else if (p.relationId !== ACCEPTED) {
      skipped.push({ programId: c.programId, name: c.name, reason: `status relationId=${p.relationId} (nie jest zaakceptowany)` });
    } else {
      configured.push({ ...c });
      seen.add(c.programId);
    }
  }

  const cfg = config.automatyczne;
  if (auto && cfg?.wlaczone) {
    const blockedIds = new Set([...(config.pominiete ?? []).map((p) => p.programId), ...(cfg.wykluczoneProgramy ?? [])]);
    const blockedCats = [...(config.wykluczoneKategorie ?? []), ...(cfg.kategorieWykluczone ?? [])];
    for (const p of allPrograms) {
      const id = Number(p.programId);
      if (seen.has(id) || blockedIds.has(id)) continue;
      if (p.relationId !== ACCEPTED || p.isXml !== true) continue;
      if (!matches(p.categoryName, cfg.kategorieDozwolone ?? [])) continue;
      if (matches(p.categoryName, blockedCats) || matches(p.programName, blockedCats)) continue;
      const entry = { programId: id, name: String(p.programName).trim(), auto: true };
      configured.push(entry);
      added.push(entry);
      seen.add(id);
    }
  }
  return { configured, skipped, added };
}
