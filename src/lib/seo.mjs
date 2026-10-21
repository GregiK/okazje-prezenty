import { shopById } from './data.mjs';
import { SITE_NAME } from '../config/site.mjs';

/** ItemList z produktami (schema.org). Linki wskazują na sklep, więc używamy offers.url = adres serwisu nie jest wymagany. */
export function productItemList(products, name) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: p.name,
        image: p.image,
        ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
        offers: {
          '@type': 'Offer',
          price: p.price.toFixed(2),
          priceCurrency: 'PLN',
          seller: { '@type': 'Organization', name: shopById.get(p.programId)?.name ?? SITE_NAME }
        }
      }
    }))
  };
}

export function breadcrumbs(site, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: new URL(it.path, site).toString()
    }))
  };
}
