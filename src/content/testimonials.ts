/**
 * Player testimonials, verbatim. The landing page renders these; the video ad
 * keeps its own copy in marketing/ad/copy.json (it paraphrases them for the
 * voiceover) — keep the two quote lists in sync when adding one.
 */
export interface Testimonial {
  quote: string;
  name: string;
  /** Rating + platform, e.g. "2091 chess.com". */
  detail: string;
}

export const TESTIMONIALS: Testimonial[] = [
  {
    quote: 'I’ve been playing good chess for the first time in months',
    name: 'DrG00se',
    detail: '2091 chess.com',
  },
  {
    quote:
      'How could it not work? Every blunder you don’t make anymore is a step in the right direction',
    name: 'Chess dad',
    detail: '600 Elo',
  },
  {
    quote: 'Being able to drill opening blunders is actually really awesome',
    name: 'FaceInterfacer',
    detail: '862 chess.com',
  },
];
