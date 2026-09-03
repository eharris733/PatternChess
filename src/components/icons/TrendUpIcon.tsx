import type { SVGProps } from 'react';

/** Rising arrow for positive-trend chips (pairs with a text label — never colour alone). */
export function TrendUpIcon({
  title,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...props}
    >
      {title && <title>{title}</title>}
      <path d="M4 17l6-6 4 4 6-7" />
      <path d="M15 8h5v5" />
    </svg>
  );
}
