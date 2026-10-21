import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Domyślna domena produkcyjna; nadpisz zmienną środowiskową SITE_URL.
const site = (process.env.SITE_URL || 'https://okazje.automatklienta.pl').replace(/\/$/, '');

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  vite: { plugins: [tailwindcss()] }
});
