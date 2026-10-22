import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPrograms } from './programs.mjs';
import { capProducts, productType } from './normalize.mjs';

const P = (programId, programName, relationId, categoryName, isXml = true) => ({ programId, programName, relationId, categoryName, isXml });
const config = {
  programs: [{ programId: 1, name: 'Ręczny OK' }, { programId: 2, name: 'Ręczny pending' }, { programId: 3, name: 'Ręczny zniknął' }],
  pominiete: [{ programId: 50 }],
  wykluczoneKategorie: ['erotyk', 'dziecka'],
  automatyczne: { wlaczone: true, kategorieDozwolone: ['biżuter', 'perfum'], kategorieWykluczone: ['zdrowie'], wykluczoneProgramy: [60] }
};
const all = [
  P(1, 'Ręczny OK', 4, 'Biżuteria'),
  P(2, 'Ręczny pending', 1, 'Biżuteria'),
  P(10, 'Nowy biżuteria', 4, 'Biżuteria, Moda'),
  P(11, 'Nowy bez feedu', 4, 'Biżuteria', false),
  P(12, 'Niezaakceptowany', 1, 'Biżuteria'),
  P(13, 'Erotyk', 4, 'Biżuteria, Erotyka'),
  P(14, 'Zdrowie', 4, 'Perfumy, Zdrowie'),
  P(15, 'Nie ta kategoria', 4, 'Elektronika'),
  P(50, 'Pominięty', 4, 'Biżuteria'),
  P(60, 'Wykluczony ID', 4, 'Biżuteria')
];

test('ręczne: tylko zaakceptowane; brak/pending trafia do skipped z powodem', () => {
  const r = pickPrograms(config, all, { auto: false });
  assert.deepEqual(r.configured.map((x) => x.programId), [1]);
  assert.equal(r.skipped.length, 2);
  assert.match(r.skipped.find((x) => x.programId === 3).reason, /brak programu/);
  assert.match(r.skipped.find((x) => x.programId === 2).reason, /relationId=1/);
});

test('auto: dodaje tylko zaakceptowane z feedem, dozwoloną kategorią i bez wykluczeń', () => {
  const r = pickPrograms(config, all);
  assert.deepEqual(r.added.map((x) => x.programId), [10]);
  assert.ok(r.configured.find((x) => x.programId === 10).auto);
});

test('auto wyłączone => nic nie dodaje', () => {
  const r = pickPrograms({ ...config, automatyczne: { ...config.automatyczne, wlaczone: false } }, all);
  assert.equal(r.added.length, 0);
});

test('wznowienie: program, który wraca do statusu 4, znów jest pokazywany', () => {
  const back = all.map((p) => (p.programId === 2 ? { ...p, relationId: 4 } : p));
  assert.ok(pickPrograms(config, back, { auto: false }).configured.some((x) => x.programId === 2));
});

test('productType rozpoznaje typy', () => {
  assert.equal(productType('Zegarek męski Casio'), 'zegarek');
  assert.equal(productType('Biżuteria LANCASTER. Bransoletka'), 'bizuteria');
  assert.equal(productType('Elegancki plecak damski'), 'plecak');
  assert.equal(productType('Listonoszka włoska'), 'torebka');
  assert.equal(productType('Coś zupełnie innego'), 'inne');
});

test('capProducts: wiele typów w wyniku, nie same plecaki', () => {
  const mk = (name, price) => ({ name, price, discount: 0 });
  const list = [
    ...Array.from({ length: 80 }, (_, i) => mk(`Wielki plecak model ${i} ${'abcdefghij'[i % 10]}`, 150)),
    ...Array.from({ length: 5 }, (_, i) => mk(`Zegarek marki ${i}`, 300)),
    ...Array.from({ length: 5 }, (_, i) => mk(`Bransoletka srebrna ${i}`, 200)),
    ...Array.from({ length: 5 }, (_, i) => mk(`Portfel skórzany ${i}`, 120))
  ];
  const out = capProducts(list, 12);
  assert.ok(out.filter((p) => productType(p.name) === 'plecak').length <= 6);
  for (const t of ['zegarek', 'bizuteria', 'portfel']) assert.ok(out.some((p) => productType(p.name) === t), t);
});

test('capProducts: obniżki zawsze wchodzą, reszta zróżnicowana (max 3 z rodziny)', () => {
  const mk = (name, price, discount = 0) => ({ name, price, discount });
  const list = [
    mk('Zegarek Casio A', 100, 30), mk('Zegarek Casio B', 120, 20),
    ...Array.from({ length: 20 }, (_, i) => mk(`Biżuteria Folli ${i}`, 150 + i)),
    ...Array.from({ length: 20 }, (_, i) => mk(`Okulary Lozza ${i}`, 160 + i)),
    mk('Torebka damska X', 140), mk('Portfel męski Y', 130)
  ];
  const out = capProducts(list, 10, { perFamily: 3, targetPrice: 150 });
  assert.equal(out.length, 10);
  assert.equal(out.filter((p) => p.discount > 0).length, 2); // obie obniżki
  assert.ok(out.filter((p) => p.name.startsWith('Biżuteria Folli')).length <= 3);
  assert.ok(out.filter((p) => p.name.startsWith('Okulary Lozza')).length <= 3);
  assert.equal(capProducts(list.slice(0, 5), 10).length, 5); // poniżej limitu bez zmian
});
