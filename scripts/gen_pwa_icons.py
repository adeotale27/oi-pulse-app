#!/usr/bin/env python3
"""Bake PWA / home-screen icons: pulse mark + thin white border."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "frontend" / "public"
TOP = (16, 185, 129)  # #10B981
MID = (5, 150, 105)   # #059669
BOT = (14, 165, 233)  # #0EA5E9


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def pulse_points(size, pad):
    inner = size - 2 * pad
    def xy(x, y):
        return pad + x / 48 * inner, pad + y / 48 * inner
    path = [(4, 24), (12, 24), (16, 24), (20, 10), (24, 38), (28, 18), (32, 24), (42, 24)]
    return [xy(x, y) for x, y in path], xy(43, 24)


def make_icon(size, border):
    radius = max(8, int(size * 0.22))
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGB", (size, size))
    gp = grad.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        c = lerp(TOP, MID, t * 1.2) if t < 0.55 else lerp(MID, BOT, (t - 0.55) / 0.45)
        for x in range(size):
            gp[x, y] = c
    mask = rounded_mask(size, radius)
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    base.paste(grad.convert("RGBA"), mask=mask)

    draw = ImageDraw.Draw(base)
    inset = max(1, border - 1)
    draw.rounded_rectangle(
        (inset, inset, size - 1 - inset, size - 1 - inset),
        radius=max(4, radius - inset),
        outline=(255, 255, 255, 255),
        width=border,
    )
    pts, dot = pulse_points(size, int(size * 0.08))
    sw = max(2, int(size * 0.055))
    draw.line(pts, fill=(255, 255, 255, 255), width=sw, joint="curve")
    r = max(2, int(size * 0.045))
    dx, dy = dot
    draw.ellipse((dx - r, dy - r, dx + r, dy + r), fill=(255, 255, 255, 255))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, mask=mask)
    return out


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    specs = [
        ("logo32.png", 32, 2),
        ("apple-touch-icon.png", 180, 4),
        ("logo192.png", 192, 4),
        ("logo256.png", 256, 5),
        ("logo512.png", 512, 10),
    ]
    for name, size, border in specs:
        path = ROOT / name
        make_icon(size, border).save(path, "PNG")
        print("wrote", path, path.stat().st_size)


if __name__ == "__main__":
    main()
