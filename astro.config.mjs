import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Domena jeszcze nieustalona — ustaw zmienną środowiskową SITE_URL (np. https://twojadomena.pl).
const site = (process.env.SITE_URL || 'http://localhost:4321').replace(/\/$/, '');

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  vite: { plugins: [tailwindcss()] }
});
