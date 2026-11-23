"""Icônes de l'app (écran d'accueil) : un chemin qui serpente, imprimé rose sur bleu, sur papier crème.

Usage : python3 tools/make_icons.py   (écrit dans public/icons/)
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
S = 1024
PAPER = (243, 238, 227)
INK = (23, 22, 42)
PINK = (255, 72, 176)
BLUE = (0, 120, 191)

# Même courbe que icon.svg (repère 64 x 64), deux arcs de Bézier cubiques.
CURVE = [((17, 50), (9, 36), (33, 40), (33, 30)), ((33, 30), (33, 20), (55, 25), (48, 13))]


def bezier(p0, p1, p2, p3, n=160):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def stroke(draw, pts, width, color):
    r = width / 2
    for a, b in zip(pts, pts[1:]):
        draw.line([a, b], fill=color, width=int(width))
    for x, y in pts[::3] + [pts[-1]]:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def icon(size, inset):
    img = Image.new("RGB", (S, S), PAPER)
    d = ImageDraw.Draw(img)
    k = (S - 2 * inset) / 64

    def T(p):
        return (inset + p[0] * k, inset + p[1] * k)

    pts = []
    for seg in CURVE:
        part = bezier(*[T(p) for p in seg])
        pts += part if not pts else part[1:]
    w = 7 * k
    off = 1.7 * k
    stroke(d, [(x + off, y + off) for x, y in pts], w, BLUE)
    stroke(d, pts, w, PINK)
    sx, sy = pts[0]
    r = 5.5 * k
    d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=PAPER, outline=INK, width=int(3 * k))
    ex, ey = pts[-1]
    r = 5 * k
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=INK)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    icon(192, 0).save(OUT / "icon-192.png")
    icon(512, 0).save(OUT / "icon-512.png")
    icon(180, 0).save(OUT / "apple-touch-icon.png")
    # Version « maskable » : marge de sécurité, Android peut rogner en cercle.
    icon(512, 150).save(OUT / "icon-maskable-512.png")
    print("icônes écrites dans", OUT)


if __name__ == "__main__":
    main()
