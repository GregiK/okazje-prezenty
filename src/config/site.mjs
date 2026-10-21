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

export const MAX_TRUSTED_CUT = 70; // % — wyższe obniżki traktujemy jako podejrzane dane sklepu (np. zawyżona cena „katalogowa”)
