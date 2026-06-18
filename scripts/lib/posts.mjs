// Shared build-time blog reader. Used by scripts/build-blog.mjs (generates the
// committed src/blog/generated-posts.ts) and scripts/gen-seo.mjs (sitemap, RSS,
// llms.txt) so both parse content/blog/*.md identically.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';

const here = dirname(fileURLToPath(import.meta.url));
export const CONTENT_DIR = join(here, '..', '..', 'content', 'blog');

// linkify is off on purpose: it would turn plain prose like "Chess.com" into a
// bogus http://Chess.com link. All real links in posts are explicit Markdown.
const md = new MarkdownIt({ html: true, linkify: false, typographer: true });

const REQUIRED = ['title', 'description', 'date'];

/** YAML may parse an unquoted date into a Date; normalize to YYYY-MM-DD. */
function toDateStr(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * Parse all published (non-draft) posts, newest first. Each post has:
 * slug, title, description, date, updated?, tags, author, ogImage?,
 * readingMinutes, html (rendered), markdown (raw body).
 */
export function readPublishedPosts() {
  if (!existsSync(CONTENT_DIR)) return [];
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'));
  const posts = [];
  for (const file of files) {
    const raw = readFileSync(join(CONTENT_DIR, file), 'utf8');
    const { data, content } = matter(raw);
    const slug = data.slug ? String(data.slug) : file.replace(/\.md$/, '');

    if (data.draft === true) {
      console.log(`  skip draft: ${slug}`);
      continue;
    }
    for (const key of REQUIRED) {
      if (!data[key]) {
        throw new Error(`content/blog/${file}: missing required frontmatter "${key}"`);
      }
    }

    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
    posts.push({
      slug,
      title: String(data.title),
      description: String(data.description),
      date: toDateStr(data.date),
      updated: data.updated ? toDateStr(data.updated) : undefined,
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      author: data.author ? String(data.author) : 'Elliot Harris',
      ogImage: data.ogImage ? String(data.ogImage) : undefined,
      readingMinutes: Math.max(1, Math.round(wordCount / 200)),
      html: md.render(content),
      markdown: content.trim(),
    });
  }
  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return posts;
}
