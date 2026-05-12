# PatternChess logo assets

Variant C — "ascent" — the mirrored knight's move, reading as upward growth.

## Files

| File | Purpose | When to use |
|---|---|---|
| `logo-horizontal-dark.svg` | Primary lockup, light text | App header, dark-mode pages |
| `logo-horizontal-light.svg` | Primary lockup, dark text | Marketing pages, partner sites, light backgrounds |
| `logo-horizontal-dark.png` (960px) | Raster fallback | Email signatures, places SVG isn't supported |
| `logo-horizontal-dark@2x.png` (1920px) | Retina raster | High-DPI raster contexts |
| `mark-only.svg` | Mark without wordmark | Collapsed nav, social avatars, watermarks |
| `mark-only-256.png` | Raster mark | Discord/Slack avatar uploads |
| `favicon.svg` | Simplified mark (no trajectory) | Modern browsers (`<link rel="icon">`) |
| `favicon.ico` | Multi-size ICO (16/32/48/64) | Legacy browser fallback |
| `favicon-{16,32,48,64}.png` | Individual favicon sizes | Specific platform requirements |
| `app-icon-{180,192,256,512}.png` | App / PWA icons | iOS home-screen, Android, manifest |
| `app-icon-512.svg` | Vector app icon master | Source for further sizes |
| `social-card-og.svg` / `.png` | 1200×630 Open Graph | Twitter, Facebook, LinkedIn preview cards |

## HTML integration

Drop this in your `<head>`:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="/app-icon-180.png">
<meta property="og:image" content="https://patternchess.com/social-card-og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://patternchess.com/social-card-og.png">
```

For the site header, the SVG embeds directly with no extra files:

```html
<a href="/" class="logo">
  <img src="/logo-horizontal-dark.svg" alt="PatternChess" height="40">
</a>
```

Or inline the SVG (smaller payload, themeable via CSS). The wordmark uses Georgia as a system serif so it renders without any web-font dependency.

## PWA manifest

```json
{
  "name": "PatternChess",
  "short_name": "PatternChess",
  "icons": [
    { "src": "/app-icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/app-icon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "background_color": "#1A1A1A",
  "theme_color": "#1A1A1A"
}
```

## Colors (from your existing palette)

| Role | Hex | Token |
|---|---|---|
| Light gold (highlight squares) | `#C49B2A` | `accent-light` |
| Dark gold (shadow squares) | `#8B6914` | `accent` |
| Background | `#1A1A1A` | `bg` |
| Wordmark light | `#E8E8E8` | `text-primary` |
| Trajectory dots / dashes | `#E8E8E8` | `text-primary` |

## Clearspace and minimum size

- Minimum padding around the mark = the width of one square (one-quarter of the mark's width).
- Don't render the full lockup (mark + wordmark) below 120px wide — the trajectory dots stop being legible. Use `mark-only.svg` or `favicon.svg` instead.
- Don't render the `favicon.svg` simplified mark below 16px — it stops reading as a chess pattern at that size.

## What not to do

- Don't recolor the squares to anything outside the two gold tones — the contrast is calibrated for the dark UI.
- Don't drop the trajectory dots and dashes from the primary lockup; they carry the "knight move" meaning. The favicon is the only place they're removed (because they vanish at small sizes anyway).
- Don't set the wordmark in a sans-serif. The serif italic on "Chess" is doing real work — it carries the "studied / classical" connotation and balances the geometric mark.
