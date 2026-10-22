# Okazje i Prezenty

Statyczny serwis afiliacyjny (Astro + Tailwind) z okazjami i kodami rabatowymi z API webePartners. Przebudowywany codziennie. Kontekst projektu: [CLAUDE.md](CLAUDE.md).

## Uruchomienie

```bash
npm install
npm run dev        # serwer deweloperski (najpierw pobiera dane)
npm run build      # pobranie danych + build do dist/
npm run preview    # podgląd zbudowanej strony
npm test           # testy normalizacji danych
```

## Tryby pobierania danych (`scripts/fetch-data.mjs`)

| Zmienne środowiskowe | Tryb |
|---|---|
| `WEBE_LOGIN` + `WEBE_PASSWORD` | prawdziwe API, Basic Auth (GitHub Actions / lokalnie) |
| `WEBE_PROXY_AUTH=1` | prawdziwe API przez proxy, które dokłada autoryzację (sesje Claude w chmurze) |
| brak | próbki z `fixtures/` (build działa bez API) |

Lokalnie, z prawdziwymi danymi (PowerShell: `$env:WEBE_LOGIN="..."`):

```bash
WEBE_LOGIN=login WEBE_PASSWORD=haslo SITE_URL=https://twojadomena.pl npm run build
```

## Konfiguracja

- **Sklepy:** `src/config/programs.json` → `programs` (lista `programId`). Po akceptacji kolejnego programu w webePartners dopisz go tutaj.
- **`SITE_URL`:** domena serwisu (canonical, Open Graph, sitemap). Domyślnie `https://okazje.automatklienta.pl`.
- **Kategorie, tekst o linkach partnerskich:** `src/config/site.mjs`.

## Śledzenie źródła sprzedaży

Do każdego linku do sklepu dodawane są `param1=www` oraz `param2=<glowna|okazje|kody|sklep>`.

## Wdrożenie (GitHub Actions → FTP)

Workflow `.github/workflows/deploy.yml` uruchamia się: codziennie o 04:15 UTC (06:15 w Polsce latem), przy pushu na `main` oraz ręcznie. Kroki: `npm ci` → `npm test` → `npm run build` (pobiera dane z webePartners) → wgranie `dist/` przez FTPS na hosting (`public_html` subdomeny). Strona: https://okazje.automatklienta.pl

**Ręczne uruchomienie:** GitHub → zakładka Actions → Deploy → Run workflow.

**Sekrety repozytorium** (Settings → Secrets and variables → Actions): `WEBE_LOGIN`, `WEBE_PASSWORD`, `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`.

**Brak sekretów webePartners:** workflow ustawia `REQUIRE_LIVE=1`, więc bez `WEBE_LOGIN`/`WEBE_PASSWORD` build kończy się błędem zamiast wdrożyć dane z fixtures.

**Gdy API webePartners zawiedzie:** `fetch-data` kończy się błędem (exit 1), build pada i deploy się **nie wykonuje** — na serwerze zostaje poprzednia, działająca wersja strony. To celowe (nie publikujemy pustej strony). Wystarczy sprawdzić log w Actions i uruchomić ponownie.

**Zmiana domeny:** w `.github/workflows/deploy.yml` zmień jedną zmienną `SITE_URL` (krok Build); domyślna wartość w `astro.config.mjs` też wskazuje na `https://okazje.automatklienta.pl`. Zadbaj, by konto FTP wskazywało katalog nowej domeny.

`public/.htaccess` (przekierowanie na https, strona 404, kompresja, cache, nagłówki bezpieczeństwa) jest kopiowany do `dist/`.
