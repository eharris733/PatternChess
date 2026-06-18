export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  /** ISO date string, YYYY-MM-DD. */
  date: string;
  updated?: string;
  tags: string[];
  author: string;
  /** Optional per-post social image (path or absolute URL). */
  ogImage?: string;
  readingMinutes: number;
}

export interface BlogPost extends BlogPostMeta {
  /** Rendered HTML body (Markdown compiled at build time). */
  html: string;
}
