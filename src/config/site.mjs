// Wspólna konfiguracja serwisu (używana przez skrypt pobierania i strony Astro).
export const SITE_NAME = 'Okazje i Prezenty';
export const SITE_TAGLINE = 'Okazje, kody rabatowe i pomysły na prezent';
export const AFFILIATE_NOTICE =
  'Serwis zawiera linki partnerskie — za zakupy przez nie możemy otrzymać prowizję, cena dla Ciebie się nie zmienia.';

// Kategorie serwisu: slug, nazwa, ikona oraz słowa kluczowe dopasowywane do kategorii z API.
export const CATEGORIES = [
  { slug: 'bizuteria', name: 'Biżuteria', icon: '💍', keys: ['biżuter', 'jubiler', 'zegark', 'naszyjnik', 'bransolet', 'kolczyk', 'pierścion', 'srebr', 'wisior', 'złot'] },
  { slug: 'perfumy-uroda', name: 'Perfumy i uroda', icon: '🌸', keys: ['perfum', 'kosmetyk', 'uroda', 'cologne', 'beauty', 'pielęgnac', 'woda toaletowa'] },
  { slug: 'kawa-herbata', name: 'Kawa i herbata', icon: '☕', keys: ['kaw', 'herbat'] },
  { slug: 'slodycze', name: 'Słodycze i delikatesy', icon: '🍫', keys: ['słodycz', 'delikates', 'czekolad', 'żywność'] },
  { slug: 'torby-plecaki', name: 'Torby i plecaki', icon: '🎒', keys: ['plecak', 'torb', 'galanteri', 'walizk', 'portfel'] },
  { slug: 'gadzety', name: 'Gadżety i prezenty', icon: '🎁', keys: ['gadżet', 'prezent', 'grawer', 'lifestyle', 'hobby', 'brelok', 'dom i wnętrza'] }
];
export const DEFAULT_CATEGORY = 'gadzety';

// Obniżkę (znaczek -X%, przekreślona cena) pokazujemy tylko, gdy obecna cena obowiązuje nie dłużej niż tyle dni.
export const DEAL_MAX_AGE_DAYS = 30;
export const MAX_TRUSTED_CUT = 70; // % — wyższe obniżki traktujemy jako podejrzane dane sklepu (np. zawyżona cena „katalogowa”)

// Kolekcje „prezent według budżetu” (strony /prezenty/<slug>). max = górna granica ceny (włącznie), min = dolna (wyłącznie).
export const COLLECTIONS = [
  { slug: 'do-50-zl', name: 'Prezent do 50 zł', icon: '🎀', max: 50, blurb: 'Małe upominki na każdą okazję: breloki, drobiazgi z grawerem i gadżety do 50 zł.' },
  { slug: '50-200-zl', name: 'Prezent od 50 do 200 zł', icon: '🎁', min: 50, max: 200, blurb: 'Pomysły na prezent od 50 do 200 zł: personalizowane upominki, srebrna biżuteria, perfumy i kosmetyki.' },
  { slug: 'powyzej-200-zl', name: 'Prezent powyżej 200 zł', icon: '👑', min: 200, blurb: 'Na wyjątkowe okazje: plecaki premium, perfumy i większe upominki.' }
];

// Dane wydawcy serwisu (wymagane do identyfikacji usługodawcy / reklamodawcy). UZUPEŁNIJ przed publicznym startem.
// Pola puste => strony pokazują komunikat o brakujących danych zamiast danych kontaktowych.
export const OPERATOR = {
  name: '',      // np. imię i nazwisko / firma
  address: '',   // adres siedziby / miejsce prowadzenia działalności
  nip: '',       // NIP (jeśli dotyczy)
  email: ''      // adres e-mail do kontaktu
};
