// Schema.org JSON-LD builders. These objects are injected into the document
// <head> by useHead and captured by the prerender step, so they reach crawlers
// and AI answer engines without JavaScript execution.

import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  SITE_LOGO,
  absoluteUrl,
} from './siteMeta';

export type JsonLd = Record<string, unknown>;

/** Site-wide publisher identity. Pairs with websiteJsonLd on the home page. */
export function organizationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: SITE_LOGO,
    description: SITE_DESCRIPTION,
  };
}

export function websiteJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
  };
}

/** The product itself — drives "free chess app" style answer-engine results. */
export function softwareApplicationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  };
}

export interface FaqItem {
  question: string;
  /** Plain-text answer. Must match the visible answer text for rich results. */
  answer: string;
}

export function faqPageJsonLd(items: FaqItem[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.question,
      acceptedAnswer: { '@type': 'Answer', text: it.answer },
    })),
  };
}

export interface ArticleJsonLdInput {
  title: string;
  description: string;
  slug: string;
  datePublished: string;
  dateModified?: string;
  author: string;
  image?: string;
}

export function articleJsonLd(post: ArticleJsonLdInput): JsonLd {
  const url = `${SITE_URL}/blog/${post.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.datePublished,
    dateModified: post.dateModified ?? post.datePublished,
    author: { '@type': 'Person', name: post.author },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: { '@type': 'ImageObject', url: SITE_LOGO },
    },
    image: post.image ? absoluteUrl(post.image) : DEFAULT_OG_IMAGE,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
  };
}

export function breadcrumbJsonLd(trail: { name: string; url: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.url),
    })),
  };
}
