import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BackLink } from '../components/BackLink';
import { Skeleton } from '../components/Skeleton';
import { HeartIcon } from '../components/icons/HeartIcon';
import { articleBySlug, rungOpen } from '../lib/progression';
import { usePathProgress } from '../hooks/usePathProgress';
import { supabaseService } from '../services/supabaseService';

/** One /path article: full text for supporters (RLS), teaser and a nudge for everyone else. */
export function ArticleRoute() {
  const { slug } = useParams();
  const article = articleBySlug(slug);
  const path = usePathProgress();
  const body = useQuery({
    queryKey: ['supporterContent', slug],
    enabled: !!article && path.isSupporter,
    staleTime: 60 * 60 * 1000,
    queryFn: () => supabaseService.getSupporterContent(slug!),
  });

  if (!article) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <BackLink to="/path" label="Your path" />
        <p className="text-text-primary">That article doesn't exist.</p>
      </div>
    );
  }

  const open = rungOpen(article.unlockAt, path.trained, path.isSupporter);

  return (
    <article className="max-w-2xl mx-auto flex flex-col gap-6" data-testid="path-article">
      <BackLink to="/path" label="Your path" />
      <header className="flex flex-col gap-2">
        <span className="label">{article.unlockAt.toLocaleString()} positions</span>
        <h1 className="heading-xl">{article.title}</h1>
      </header>

      {path.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : path.isSupporter ? (
        body.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : body.data ? (
          <div className="blog-content" dangerouslySetInnerHTML={{ __html: body.data }} />
        ) : (
          <p className="text-text-primary">This article isn't available right now. Try again in a moment.</p>
        )
      ) : (
        <>
          <p className="text-lg text-text-primary leading-relaxed" dangerouslySetInnerHTML={{ __html: article.teaserHtml }} />
          <section className="card flex flex-col gap-3 border-gold-dark" data-testid="article-supporter-gate">
            <p className="flex items-center gap-2 font-semibold">
              <HeartIcon className="h-4 w-4" />
              {open ? 'The rest of this article is for supporters.' : `Unlocks at ${article.unlockAt.toLocaleString()} positions.`}
            </p>
            <p className="text-sm text-text-primary">
              {open
                ? '$5 a month keeps PatternChess running, and supporters read every article on the path.'
                : `${(article.unlockAt - path.trained).toLocaleString()} positions to go. Supporters can read every article now.`}
            </p>
            <div>
              <Link to="/supporter" className="btn-primary">
                Become a supporter
              </Link>
            </div>
          </section>
        </>
      )}
    </article>
  );
}
