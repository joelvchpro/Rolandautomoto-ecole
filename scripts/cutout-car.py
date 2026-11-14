#!/usr/bin/env python3
"""Détourage voiture JPEG → PNG transparent (flood fill coins + nettoyage frange)."""
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


def facing_right(img: Image.Image) -> bool:
    px = img.convert("RGBA").load()
    w, h = img.size

    def count(x0: int, x1: int, pred) -> int:
        n = 0
        for y in range(h // 4, 3 * h // 4):
            for x in range(x0, x1):
                r, g, b, a = px[x, y]
                if a > 128 and pred(r, g, b):
                    n += 1
        return n

    red_left = count(0, w // 4, lambda r, g, b: r > 150 and g < 90 and b < 90)
    red_right = count(3 * w // 4, w, lambda r, g, b: r > 150 and g < 90 and b < 90)
    return red_left >= red_right


def is_bg(r: int, g: int, b: int, a: int, tol: int) -> bool:
    if a == 0:
        return True
    return min(r, g, b) >= 255 - tol and max(r, g, b) - min(r, g, b) <= 8


def cutout(src: Path, dst: Path, tol: int = 22) -> None:
    img = Image.open(src).convert("RGBA")
    if not facing_right(img):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)

    px = img.load()
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()
    for x in range(0, w, 4):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(0, h, 4):
        q.append((0, y))
        q.append((w - 1, y))

    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or visited[y][x]:
            continue
        visited[y][x] = True
        r, g, b, a = px[x, y]
        if not is_bg(r, g, b, a, tol):
            continue
        mp[x, y] = 255
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    msp = mask.load()
    out = img.copy()
    op = out.load()
    for y in range(h):
        for x in range(w):
            m = msp[x, y]
            r, g, b, a = op[x, y]
            if not m:
                continue
            na = max(0, int(a * (1 - m / 255.0)))
            if na < 40 and min(r, g, b) > 230:
                na = 0
            op[x, y] = (r, g, b, na)

    to_clear = []
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            r, g, b, a = op[x, y]
            if a < 20 or min(r, g, b) < 245:
                continue
            if any(
                op[x + dx, y + dy][3] < 15
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1))
            ):
                to_clear.append((x, y))
    for x, y in to_clear:
        r, g, b, _ = op[x, y]
        op[x, y] = (r, g, b, 0)

    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, "PNG", optimize=True)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("src", type=Path)
    p.add_argument("dst", type=Path)
    p.add_argument("--tol", type=int, default=22)
    args = p.parse_args()
    cutout(args.src, args.dst, tol=args.tol)
    print(f"OK → {args.dst}")


if __name__ == "__main__":
    main()
