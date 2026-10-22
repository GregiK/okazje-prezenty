export function GET({ site }: { site: URL }) {
  const body = `User-agent: *\nAllow: /\nDisallow: /idz/\n\nSitemap: ${new URL('/sitemap.xml', site)}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
