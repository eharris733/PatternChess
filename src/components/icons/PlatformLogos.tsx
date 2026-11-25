/**
 * The Lichess and Chess.com marks, used only to identify those platforms next
 * to their names (sign-in buttons, username fields, platform pickers, sync
 * rows). Never as PatternChess branding, never altered beyond colour.
 *
 * Source: Simple Icons 13.21.0 (https://simpleicons.org, icons/lichess.svg and
 * icons/chessdotcom.svg). The SVG path data is CC0-1.0; the marks themselves
 * remain trademarks of Lichess and Chess.com, used here nominatively to name
 * the platform a username or sign-in belongs to.
 */

export type PlatformId = 'lichess' | 'chesscom';

/** The platforms' own names (brand names, never translated). */
export const PLATFORM_NAME: Record<PlatformId, string> = { lichess: 'Lichess', chesscom: 'Chess.com' };

interface LogoProps {
  className?: string;
  /** Accessible name; omit when a visible label sits beside the logo. */
  title?: string;
  /** Draw in the current text colour instead of the brand colour. */
  mono?: boolean;
}

const LICHESS_PATH =
  'M10.457 6.161a.237.237 0 0 0-.296.165c-.8 2.785 2.819 5.579 5.214 7.428.653.504 1.216.939 1.591 1.292 1.745 1.642 2.564 2.851 2.733 3.178a.24.24 0 0 0 .275.122c.047-.013 4.726-1.3 3.934-4.574a.257.257 0 0 0-.023-.06L18.204 3.407 18.93.295a.24.24 0 0 0-.262-.293c-1.7.201-3.115.435-4.5 1.425-4.844-.323-8.718.9-11.213 3.539C.334 7.737-.246 11.515.085 14.128c.763 5.655 5.191 8.631 9.081 9.532.993.229 1.974.34 2.923.34 3.344 0 6.297-1.381 7.946-3.85a.24.24 0 0 0-.372-.3c-3.411 3.527-9.002 4.134-13.296 1.444-4.485-2.81-6.202-8.41-3.91-12.749C4.741 4.221 8.801 2.362 13.888 3.31c.056.01.115 0 .165-.029l.335-.197c.926-.546 1.961-1.157 2.873-1.279l-.694 1.993a.243.243 0 0 0 .02.202l6.082 10.192c-.193 2.028-1.706 2.506-2.226 2.611-.287-.645-.814-1.364-2.306-2.803-.422-.407-1.21-.941-2.124-1.56-2.364-1.601-5.937-4.02-5.391-5.984a.239.239 0 0 0-.165-.295z';

const CHESSCOM_PATH =
  'M12 0a3.85 3.85 0 0 0-3.875 3.846A3.84 3.84 0 0 0 9.73 6.969l-2.79 1.85c0 .622.144 1.114.434 1.649H9.83c-.014.245-.014.549-.014.925 0 .025.003.048.006.071-.064 1.353-.507 3.472-3.62 5.842-.816.625-1.423 1.495-1.806 2.533a.33.33 0 0 0-.045.084 8.124 8.124 0 0 0-.39 2.516c0 .1.216 1.561 8.038 1.561s8.038-1.46 8.038-1.561c0-2.227-.824-4.048-2.24-5.133-4.034-3.08-3.586-5.74-3.644-6.838h2.458c.29-.535.434-1.027.434-1.649l-2.79-1.836a3.86 3.86 0 0 0 1.604-3.123A3.873 3.873 0 0 0 13.445.275c-.004-.002-.01.004-.015.004A3.76 3.76 0 0 0 12 0Z';

/** Chess.com's pawn green (Simple Icons brand hex). Lichess is monochrome. */
export const CHESSCOM_GREEN = '#81B64C';

/**
 * Darker chess.com green for filled surfaces (the active platform pill): the
 * pawn hex reads as neon at button size and fails contrast with light text.
 */
export const CHESSCOM_GREEN_DARK = '#4E7A31';

function Mark({ d, fill, className, title, testId }: { d: string; fill: string; className?: string; title?: string; testId: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
      data-testid={testId}
    >
      {title && <title>{title}</title>}
      <path d={d} fill={fill} />
    </svg>
  );
}

export function LichessLogo({ className, title }: LogoProps) {
  return <Mark d={LICHESS_PATH} fill="currentColor" className={className} title={title} testId="logo-lichess" />;
}

export function ChesscomLogo({ className, title, mono = false }: LogoProps) {
  return (
    <Mark
      d={CHESSCOM_PATH}
      fill={mono ? 'currentColor' : CHESSCOM_GREEN}
      className={className}
      title={title}
      testId="logo-chesscom"
    />
  );
}

export function PlatformLogo({ platform, ...props }: LogoProps & { platform: PlatformId }) {
  return platform === 'lichess' ? <LichessLogo {...props} /> : <ChesscomLogo {...props} />;
}
