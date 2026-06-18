// Per-route document <head> management without a library.
//
// Why custom: the app is client-rendered and prerendered via Playwright
// (scripts/prerender.mjs reads the final DOM), so we only need to imperatively
// keep <head> correct — not the streaming-SSR dedupe semantics of
// react-helmet-async (unmaintained) or @unhead. ~1 effect, no deps.
//
// On every run the hook fully manages a fixed set of tags (title, description,
// canonical, og:*, twitter:*, robots) so values never leak across client-side
// navigations, and it replaces any JSON-LD it previously injected. The static
// defaults in index.html are upserted in place rather than duplicated.

import { useEffect } from 'react';
import { SITE_NAME, DEFAULT_OG_IMAGE, absoluteUrl } from './siteMeta';
import type { JsonLd } from './jsonLd';

export interface HeadOptions {
  /** Page title. SITE_NAME is appended unless the string already contains it. */
  title: string;
  description?: string;
  /** Path ("/about") or absolute URL. Defaults to the current pathname. */
  canonical?: string;
  /** OG/Twitter image, path or absolute. Defaults to the site social card. */
  image?: string;
  type?: 'website' | 'article';
  /** Defaults to "index,follow". Pass "noindex,follow" to keep out of search. */
  robots?: string;
  jsonLd?: JsonLd | JsonLd[];
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useHead(opts: HeadOptions) {
  const { title, description, canonical, image, type = 'website', robots = 'index,follow', jsonLd } =
    opts;

  // Serialize JSON-LD so the effect re-runs on content change without depending
  // on object identity (which would change every render).
  const jsonLdKey = jsonLd ? JSON.stringify(jsonLd) : '';

  useEffect(() => {
    const fullTitle = title.includes(SITE_NAME) ? title : `${title} — ${SITE_NAME}`;
    const url = absoluteUrl(canonical ?? window.location.pathname);
    const img = image ? absoluteUrl(image) : DEFAULT_OG_IMAGE;

    document.title = fullTitle;
    upsertMeta('name', 'robots', robots);
    upsertLink('canonical', url);
    if (description) upsertMeta('name', 'description', description);

    upsertMeta('property', 'og:title', fullTitle);
    if (description) upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:image', img);
    upsertMeta('property', 'og:url', url);
    upsertMeta('property', 'og:type', type);

    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', fullTitle);
    if (description) upsertMeta('name', 'twitter:description', description);
    upsertMeta('name', 'twitter:image', img);

    // Replace any JSON-LD this hook injected previously, then add the current.
    document.head.querySelectorAll('script[data-managed-seo]').forEach((n) => n.remove());
    const blocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
    const added = blocks.map((block) => {
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.setAttribute('data-managed-seo', '');
      s.textContent = JSON.stringify(block);
      document.head.appendChild(s);
      return s;
    });

    return () => added.forEach((n) => n.remove());
    // jsonLdKey stands in for jsonLd; the rest are primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, canonical, image, type, robots, jsonLdKey]);
}
