import { Link } from 'react-router-dom';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { LandingFooter } from '../components/landing/LandingFooter';
import { getAllPosts, formatPostDate } from '../blog/posts';
import { useHead } from '../seo/useHead';
import { websiteJsonLd } from '../seo/jsonLd';

export function BlogIndex() {
  const posts = getAllPosts();

  useHead({
    title: 'Chess Improvement Blog',
    description:
      'Practical guides on cutting blunders, the Woodpecker Method, spaced repetition, and getting better at chess by training your own games.',
    canonical: '/blog',
    jsonLd: websiteJsonLd(),
  });

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans flex flex-col">
      <LandingTopBar />
      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <h1 className="text-3xl font-bold tracking-tight">Chess Improvement Blog</h1>
          <p className="mt-3 text-lg text-text-primary/70">
            Guides on cutting blunders and training smarter — from the team building PatternChess.
          </p>

          {posts.length === 0 ? (
            <p className="mt-10 text-text-primary/60">No posts yet. Check back soon.</p>
          ) : (
            <div className="mt-10 flex flex-col divide-y-2 divide-text-primary/10">
              {posts.map((post) => (
                <article key={post.slug} className="py-6 first:pt-0">
                  <Link to={`/blog/${post.slug}`} className="group block">
                    <h2 className="text-xl font-bold tracking-tight group-hover:text-gold-dark transition-colors">
                      {post.title}
                    </h2>
                    <p className="mt-1 font-mono uppercase text-[11px] tracking-tight text-text-primary/50">
                      {formatPostDate(post.date)} · {post.readingMinutes} min read
                    </p>
                    <p className="mt-3 leading-relaxed text-text-primary/80">{post.description}</p>
                    <span className="mt-3 inline-block font-mono uppercase text-xs tracking-tight text-gold-dark">
                      Read →
                    </span>
                  </Link>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
