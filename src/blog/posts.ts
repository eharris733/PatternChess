// Public API over the build-time-generated blog data. Components import from
// here, never from generated-posts directly, so the generated module stays an
// implementation detail. BLOG_POSTS is already sorted newest-first and excludes
// drafts (see scripts/build-blog.mjs).

import { BLOG_POSTS } from './generated-posts';
import type { BlogPost } from './types';

export type { BlogPost } from './types';

export function getAllPosts(): BlogPost[] {
  return BLOG_POSTS;
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

/** Render an ISO date (YYYY-MM-DD) as e.g. "June 12, 2026". */
export function formatPostDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
