"""The "Sticker" piece set (public/pieces/sticker), drawn for PatternChess.

Chunky flat Staunton pieces with a thick outline and a shaded right side.
Original geometry, no traced or copied artwork (public/pieces/LICENSES.md).
Regenerate:  python3 scripts/gen-sticker-pieces.py public/pieces/sticker
"""
import os, sys
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

BASE = '<path d="M22 91 Q22 81 33 80 L67 80 Q78 81 78 91 Z"/>'

def band(x1, x2, y, h=6):
    return f'<rect x="{x1}" y="{y}" width="{x2-x1}" height="{h}" rx="3"/>'

PIECES = {
  'P': [
    '<path d="M37 80 Q38 58 45 46 L55 46 Q62 58 63 80 Z"/>',
    band(35, 65, 44, 6),
    '<circle cx="50" cy="29" r="13"/>',
    BASE,
  ],
  'R': [
    '<path d="M33 80 L36 42 L64 42 L67 80 Z"/>',
    '<path d="M27 42 L27 16 L37 16 L37 24 L45 24 L45 16 L55 16 L55 24 L63 24 L63 16 L73 16 L73 42 Z"/>',
    band(29, 71, 40, 7),
    band(31, 69, 73, 7),
    BASE,
  ],
  'B': [
    '<path d="M40 80 L43 66 L57 66 L60 80 Z"/>',
    '<circle cx="50" cy="10" r="5.5"/>',
    '<path d="M50 14 C65 24 67 46 58 62 L42 62 C33 46 35 24 50 14 Z"/>',
    band(35, 65, 60, 7),
    BASE,
  ],
  'N': [
    '<path d="M33 80 C33 68 38 61 45 55 C38 55 31 59 25 57 C18 55 16 46 21 39 C27 29 37 22 45 18 L47 9 L56 17 C71 23 78 40 76 58 C75 67 71 73 71 80 Z"/>',
    BASE,
  ],
  'Q': [
    '<path d="M31 78 L21 31 L33 47 L36 23 L44 45 L50 18 L56 45 L64 23 L67 47 L79 31 L69 78 Z"/>',
    '<circle cx="21" cy="28" r="5"/>',
    '<circle cx="36" cy="20" r="5"/>',
    '<circle cx="50" cy="14" r="5"/>',
    '<circle cx="64" cy="20" r="5"/>',
    '<circle cx="79" cy="28" r="5"/>',
    band(30, 70, 70, 8),
    BASE,
  ],
  'K': [
    '<path d="M31 78 C27 62 26 50 30 41 L70 41 C74 50 73 62 69 78 Z"/>',
    '<path d="M30 43 C31 27 69 27 70 43 Z"/>',
    '<rect x="45.5" y="5" width="9" height="26" rx="2.5"/>',
    '<rect x="39" y="11" width="22" height="9" rx="2.5"/>',
    band(30, 70, 70, 8),
    BASE,
  ],
}

# Lines drawn on top (detail), in the outline colour (white) / light colour (black).
DETAIL = {
  'P': [],
  'R': [],
  'B': ['<path d="M56 27 L46 40" stroke-width="4" stroke-linecap="round" fill="none"/>'],
  'N': [
    '<circle cx="40" cy="31" r="3.4" stroke="none"/>',
    '<circle cx="24.5" cy="46.5" r="1.8" stroke="none"/>',
    '<path d="M56 18 C67 25 72 38 71 54" stroke-width="3.5" stroke-linecap="round" fill="none"/>',
  ],
  'Q': [],
  'K': [],
}

COLORS = {
  'w': dict(fill='#F7F0E1', shade='#E3D4B6', out='#1C1A17', detail='#1C1A17'),
  'b': dict(fill='#46413D', shade='#322E2B', out='#0E0D0C', detail='#F2E9D6'),
}

for side, c in COLORS.items():
    for k, shapes in PIECES.items():
        sil = ''.join(shapes)
        det = ''.join(d.replace('/>', f' stroke="{c["detail"]}" fill="{c["detail"]}"/>' if 'fill="none"' not in d else f' stroke="{c["detail"]}"/>') if 'stroke="none"' not in d else d.replace('/>', f' fill="{c["detail"]}"/>') for d in DETAIL[k])
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            f'<defs><clipPath id="s">{sil}</clipPath></defs>'
            f'<g fill="{c["fill"]}">{sil}</g>'
            f'<rect x="61" y="0" width="40" height="100" fill="{c["shade"]}" clip-path="url(#s)"/>'
            f'<g fill="none" stroke="{c["out"]}" stroke-width="4.5" stroke-linejoin="round">{sil}</g>'
            f'{det}'
            '</svg>'
        )
        open(os.path.join(OUT, f'{side}{k}.svg'), 'w').write(svg)
print('written', len(os.listdir(OUT)))
