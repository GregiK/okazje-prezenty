# CLAUDE.md — kontekst projektu

## Cel
Statyczny, szybki serwis afiliacyjny **„Okazje i Prezenty”** (okazje + kody rabatowe + pomysły na prezent) dla polskiego wydawcy sieci **webePartners**. Ruch głównie z Facebooka na telefonach → mobile-first. Odwiedzający klika w produkt/kod → trafia do sklepu przez link afiliacyjny. Użytkownik (Grzegorz) to osoba techniczna planująca sprzedaż na Allegro; zależy mu na niskich kosztach — **żadnych płatnych usług ani zależności wymagających konta**. Język treści i komunikatów: polski.

## Etapy
1. **ETAP 1 (zrobiony)** — projekt Astro + Tailwind, skrypt pobierania danych, fixtures, strony, SEO, README.
2. **ETAP 2 (zrobiony)** — wdrożenie: `.github/workflows/deploy.yml` (cron 04:15 UTC, ręcznie, push na `main`) → test → build → FTPS (SamKirkland/FTP-Deploy-Action) do `public_html` subdomeny na DirectAdmin. Sekrety repo: `WEBE_LOGIN`, `WEBE_PASSWORD`, `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`. `SITE_URL` jest w workflow (jawnie, nie sekret).
3. **ETAP 3 (do ustalenia)** — rozszerzenia (np. więcej sklepów po akceptacji, poradniki/kolekcje prezentowe, Omnibus — patrz niżej).

## Wdrożenie i adres
- Adres strony: **https://okazje.automatklienta.pl** (domyślny `SITE_URL` w `astro.config.mjs` i w workflow).
- Błąd `fetch-data` (exit 1) → build pada → deploy się nie wykonuje; na serwerze zostaje poprzednia wersja (celowe).
- `public/.htaccess` (https, 404, gzip, cache, nagłówki bezpieczeństwa) trafia do `dist/`. Bez `dangerous-clean-slate`.

## Architektura
- `scripts/fetch-data.mjs` — pobiera `GetPrograms`, `GetHotPrice` (per program z konfiguracji), `GetVouchers`; normalizuje (`scripts/normalize.mjs`) i zapisuje do `src/data/*.json` (`products`, `vouchers`, `shops`, `meta`). `src/data/` jest w `.gitignore` (generowane).
  - Tryby: `WEBE_LOGIN`+`WEBE_PASSWORD` → Basic Auth (Actions); `WEBE_PROXY_AUTH=1` → bez nagłówka (sesje Claude w chmurze; proxy dokłada auth; skrypt sam ustawia `NODE_USE_ENV_PROXY=1`); brak env → `fixtures/`.
  - W trybie live pusty wynik = błąd (exit 1), żeby nie opublikować pustej strony.
  - `GetHotPrice` bez `programId` zwraca tylko ~2000 pozycji (dominują sklepy spoza konfiguracji) — dlatego zawsze pobieramy osobno dla każdego programu z konfiguracji.
- `src/config/programs.json` — **lista sklepów do pokazania** (`programs`), kandydaci czekający na akceptację (`oczekujace`, nieużywani), słowa wykluczonych kategorii. Env `PROGRAM_IDS=1,2,3` nadpisuje listę (testy).
- `src/config/site.mjs` — nazwa serwisu, tekst informacji o linkach partnerskich, kategorie serwisu (dopasowanie po słowach kluczowych z API), `MAX_TRUSTED_CUT`.
- `src/lib/data.mjs` — import danych, `trackedUrl()` (dokleja `param1=www&param2=<typ strony>`), formatowanie cen/dat.
- Strony: `/`, `/okazje` (filtry/sortowanie po stronie klienta, ~40 linii JS inline, stan w URL: `?sklep=&kategoria=&sort=`), `/kody-rabatowe`, `/sklep/[program]`, `/o-serwisie`, `/polityka-prywatnosci`, `/404`, `robots.txt`, `sitemap.xml`.
- `/api/okazje.json` — publiczny feed (produkty wg rabatu + kody, linki bez param1/param2) dla n8n: workflow „Okazje 02 — Posty z okazjami” dokleja `param1=fb` i publikuje na fanpage. Nie zmieniaj nazw pól bez aktualizacji tego workflow.
- Brak bazy, backendu, analityki i cookies.

## Fakty o API (sprawdzone na prawdziwych danych, 2026-10-21)
- `productImages` to **obiekt** `{productImagesUrl: [], productThumbUrl}`; `category.webeCategoryName` to tablica; opis w polu `productDescritption` (sic!). Czasem brak kategorii (Paryskie) → kategoria z `shopCategoryName`/nazwy.
- `priceCut` = % obniżki względem najwyższej ceny z `previousPrice`; stara cena liczona jako `cena / (1 - priceCut/100)`. Obniżki > `MAX_TRUSTED_CUT` (70%) uznajemy za podejrzane (bez przekreślonej ceny).
- `relationId`: 4 = zaakceptowany (13 programów), 1 = prawdopodobnie oczekuje na akceptację, 0 = brak relacji. Produkty zwracają tylko zaakceptowane programy.
- Linki afiliacyjne mają już `?r=...` — parametry dokładamy przez `URL.searchParams`.
- `voucherCode` bywa opisem („zapis do newslettera”), nie kodem — wtedy `code=null` i karta ma tylko „Przejdź do promocji”.

## Zasady
- Sekrety wyłącznie z env — nigdy w kodzie/commitach. Zmienna `SITE_URL` ustala domenę (canonical, OG, sitemap); zmiana domeny = jedna zmienna w `deploy.yml`.
- Linki afiliacyjne: `rel="sponsored nofollow noopener" target="_blank"`. Informacja o linkach partnerskich widoczna w stopce i nad listami; ceny z dopiskiem „cena z dnia <data aktualizacji>”.
- Nie pokazujemy: erotyka, dla dziecka/zabawki/parenting.
- Oszczędzaj kontekst: dużych odpowiedzi API nie czytaj w całości (`jq`/`head`).
- Użytkownik prosi o dokończenie zadania do końca i potwierdzenie; zwracaj się do niego „Grzegorz”.

## Do rozważenia (etap 3)
- **Omnibus (UE):** „stara cena” pochodzi z historii sklepu/webePartners; dla uczciwości warto pokazywać najniższą cenę z 30 dni lub oznaczać „cena poprzednia wg sklepu”.
- Dodanie sklepów z `oczekujace` po akceptacji (Cocoa, Cup&You mają kody).
