import { Link, useParams } from 'react-router-dom';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { LandingFooter } from '../components/landing/LandingFooter';
import { getPostBySlug, formatPostDate } from '../blog/posts';
import { useHead } from '../seo/useHead';
import { articleJsonLd, breadcrumbJsonLd } from '../seo/jsonLd';

export function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? getPostBySlug(slug) : undefined;

  // useHead must run unconditionally (hook rules); branch on found/not-found.
  useHead(
    post
      ? {
          title: post.title,
          description: post.description,
          canonical: `/blog/${post.slug}`,
          type: 'article',
          image: post.ogImage,
          jsonLd: [
            articleJsonLd({
              title: post.title,
              description: post.description,
              slug: post.slug,
              datePublished: post.date,
              dateModified: post.updated,
              author: post.author,
              image: post.ogImage,
              wordCount: post.wordCount,
            }),
            breadcrumbJsonLd([
              { name: 'Home', url: '/' },
              { name: 'Blog', url: '/blog' },
              { name: post.title, url: `/blog/${post.slug}` },
            ]),
          ],
        }
      : {
          title: 'Post not found',
          description: 'This blog post could not be found.',
          canonical: slug ? `/blog/${slug}` : '/blog',
          robots: 'noindex,follow',
        },
  );

  if (!post) {
    return (
      <div className="min-h-screen bg-bg text-text-primary font-sans flex flex-col">
        <LandingTopBar />
        <main id="main" className="flex-1 scroll-mt-20">
          <div className="max-w-3xl mx-auto px-6 py-20 text-center">
            <h1 className="text-2xl font-bold tracking-tight">Post not found</h1>
            <p className="mt-3 text-text-primary/70">We couldn&apos;t find that post.</p>
            <Link
              to="/blog"
              className="mt-6 inline-block font-mono uppercase text-xs tracking-tight text-gold-dark underline underline-offset-2"
            >
              ← Back to the blog
            </Link>
          </div>
        </main>
        <LandingFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans flex flex-col">
      <LandingTopBar />
      <main id="main" className="flex-1 scroll-mt-20">
        <article className="max-w-3xl mx-auto px-6 py-12">
          <Link
            to="/blog"
            className="font-mono uppercase text-xs tracking-tight text-text-primary/60 hover:text-gold-dark transition-colors"
          >
            ← Blog
          </Link>
          <h1 className="mt-6 text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
            {post.title}
          </h1>
          <p className="mt-3 font-mono uppercase text-[11px] tracking-tight text-text-primary/50">
            {formatPostDate(post.date)} · {post.readingMinutes} min read · {post.author}
          </p>

          {/* Trusted, build-time-rendered Markdown (no user input). */}
          <div
            className="blog-content mt-10"
            dangerouslySetInnerHTML={{ __html: post.html }}
          />

          <div className="mt-14 border-t-2 border-text-primary/10 pt-8">
            <Link
              to="/login"
              className="inline-block font-mono uppercase text-xs tracking-tight border-2 border-text-primary bg-text-primary text-bg px-5 py-3 rounded-none shadow-[3px_3px_0_#8B6914] hover:shadow-[1px_1px_0_#8B6914] hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
            >
              Train your own blunders — free
            </Link>
          </div>
        </article>
      </main>
      <LandingFooter />
    </div>
  );
}
