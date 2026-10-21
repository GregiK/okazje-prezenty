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
- **`SITE_URL`:** domena serwisu (canonical, Open Graph, sitemap). Bez niej używany jest `http://localhost:4321`.
- **Kategorie, tekst o linkach partnerskich:** `src/config/site.mjs`.

## Śledzenie źródła sprzedaży

Do każdego linku do sklepu dodawane są `param1=www` oraz `param2=<glowna|okazje|kody|sklep>`.

## Wdrożenie

Etap 2 (GitHub Actions → FTP na DirectAdmin) — jeszcze niezrobiony.
