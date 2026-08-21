# -*- coding: utf-8 -*-
"""アプリのアイコンを作る。3×3グリッドの1マスが光っている図。
   Pillow を使わずに PNG を直接書き出す（依存を増やさないため）。"""
import struct
import zlib
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')

BG = (0x12, 0x15, 0x1b)      # --bg
CELL = (0x2c, 0x34, 0x42)    # --line
LIT = (0x6e, 0xa8, 0xff)     # --accent


def write_png(path, width, height, pixels):
    """pixels: [(r,g,b), ...] を行優先で width*height 個"""
    raw = bytearray()
    i = 0
    for _ in range(height):
        raw.append(0)                      # フィルタなし
        for _ in range(width):
            r, g, b = pixels[i]
            raw += bytes((r, g, b))
            i += 1

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)  # 8bit RGB
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


def make_icon(size, pad_ratio, lit_index=2):
    px = [BG] * (size * size)
    pad = size * pad_ratio
    inner = size - 2 * pad
    gap = inner * 0.075
    cell = (inner - 2 * gap) / 3.0
    radius = cell * 0.22                      # 角丸

    boxes = []
    for r in range(3):
        for c in range(3):
            x0 = pad + c * (cell + gap)
            y0 = pad + r * (cell + gap)
            boxes.append((x0, y0, x0 + cell, y0 + cell, r * 3 + c))

    for y in range(size):
        for x in range(size):
            cx, cy = x + 0.5, y + 0.5
            for (x0, y0, x1, y1, idx) in boxes:
                if not (x0 <= cx <= x1 and y0 <= cy <= y1):
                    continue
                # 角丸：四隅だけ円で判定する
                dx = 0.0
                dy = 0.0
                if cx < x0 + radius:
                    dx = (x0 + radius) - cx
                elif cx > x1 - radius:
                    dx = cx - (x1 - radius)
                if cy < y0 + radius:
                    dy = (y0 + radius) - cy
                elif cy > y1 - radius:
                    dy = cy - (y1 - radius)
                if dx * dx + dy * dy > radius * radius:
                    continue
                px[y * size + x] = LIT if idx == lit_index else CELL
                break
    return px


os.makedirs(OUT, exist_ok=True)

targets = [
    ('icon-192.png', 192, 0.16),
    ('icon-512.png', 512, 0.16),
    ('icon-maskable-512.png', 512, 0.24),   # マスク時に角が欠けないよう余白を広く
    ('apple-touch-icon.png', 180, 0.16),
]

for name, size, pad in targets:
    write_png(os.path.join(OUT, name), size, size, make_icon(size, pad))
    print('%s  %dx%d  %d bytes' % (name, size, size,
                                   os.path.getsize(os.path.join(OUT, name))))
