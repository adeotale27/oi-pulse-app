#!/usr/bin/env python3
"""Bake PWA / home-screen icons: same pulse mark as in-app, sharp, thin white rim."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "frontend" / "public"
# Diagonal green → cyan, matching OiPulseLogo stops.
C0 = (16, 185, 129)   # #10B981
C1 = (5, 150, 105)    # #059669
C2 = (14, 165, 233)   # #0EA5E9


def lerp(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def color_at(x, y, size):
    t = (x + y) / (2 * max(size - 1, 1))
    if t < 0.55:
        return lerp(C0, C1, t / 0.55)
    return lerp(C1, C2, (t - 0.55) / 0.45)


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def pulse_points(size, pad):
    inner = size - 2 * pad

    def xy(x, y):
        return pad + x / 48.0 * inner, pad + y / 48.0 * inner

    # Same path as OiPulseLogo.jsx
    path = [(4, 24), (12, 24), (16, 24), (20, 10), (24, 38), (28, 18), (32, 24), (42, 24)]
    return [xy(x, y) for x, y in path], xy(43, 24)


def make_icon(size, border):
    scale = 4
    S = size * scale
    B = max(scale, border * scale)
    radius = int(S * 0.22)
    grad = Image.new("RGB", (S, S))
    px = grad.load()
    for y in range(S):
        for x in range(S):
            px[x, y] = color_at(x, y, S)
    mask = rounded_mask(S, radius)
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    base.paste(grad.convert("RGBA"), mask=mask)

    draw = ImageDraw.Draw(base)
    # Thin white rim just inside the rounded square (not a fat frame).
    inset = B // 2
    draw.rounded_rectangle(
        (inset, inset, S - 1 - inset, S - 1 - inset),
        radius=max(scale * 4, radius - inset),
        outline=(255, 255, 255, 255),
        width=B,
    )
    pts, dot = pulse_points(S, int(S * 0.10))
    sw = max(scale * 2, int(S * 0.048))
    draw.line(pts, fill=(255, 255, 255, 255), width=sw, joint="curve")
    r = max(scale * 2, int(S * 0.042))
    dx, dy = dot
    draw.ellipse((dx - r, dy - r, dx + r, dy + r), fill=(255, 255, 255, 255))
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(base, mask=mask)
    return out.resize((size, size), Image.Resampling.LANCZOS)


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    # Border in CSS-px: ~1.5–2px at 180, ~3px at 512.
    specs = [
        ("logo32.png", 32, 1),
        ("apple-touch-icon.png", 180, 2),
        ("logo192.png", 192, 2),
        ("logo256.png", 256, 3),
        ("logo512.png", 512, 4),
    ]
    for name, size, border in specs:
        path = ROOT / name
        make_icon(size, border).save(path, "PNG")
        print("wrote", path, path.stat().st_size)


if __name__ == "__main__":
    main()
