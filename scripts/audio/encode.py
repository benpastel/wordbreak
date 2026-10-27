# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "soundfile", "pyloudnorm"]
# ///
"""Turn a loop from loop.py into what the game downloads: an MP3, and a module
telling the game how long the loop is and how loud.

    uv run scripts/audio/encode.py audio/work/menu-loop.wav public/music/menu.mp3 \\
        --module src/client/menuMusic.ts

Every lossy format pads the start and end of a file by an amount that differs by
encoder and by browser, which is what puts a gap in most looping web audio. So the
file is the loop followed by its own first --head seconds again: anywhere inside it,
the sound repeats exactly every loop length, and the game loops over a span that
starts after the padding and ends before it, whatever the padding turned out to be.

The module carries the loop's loudness (LUFS, the measure broadcasters and games
level by) so the game can set music to a level rather than to whatever the file
happens to peak at.
"""

import argparse
import os
import subprocess
import tempfile

import numpy as np
import pyloudnorm
import soundfile as sf


def main():
    p = argparse.ArgumentParser()
    p.add_argument("loop")
    p.add_argument("out")
    p.add_argument("--module", required=True)
    p.add_argument("--head", type=float, default=1.0)
    p.add_argument("--quality", default="4", help="LAME VBR quality, 0 best to 9 smallest")
    a = p.parse_args()

    x, sr = sf.read(a.loop, always_2d=True)
    lufs = pyloudnorm.Meter(sr).integrated_loudness(np.tile(x, (2, 1)))
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "padded.wav")
        sf.write(wav, np.concatenate([x, x[: int(a.head * sr)]]), sr, subtype="PCM_24")
        os.makedirs(os.path.dirname(a.out), exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-c:a", "libmp3lame", "-q:a", a.quality, a.out],
            check=True,
        )

    url = "/" + os.path.relpath(a.out, "public")
    with open(a.module, "w") as f:
        f.write(
            "// Written by scripts/audio/encode.py; change the recipe in scripts/audio/, not this.\n"
            f"export const MENU_MUSIC = {{ url: '{url}', loopSeconds: {len(x) / sr:.6f}, "
            f"headSeconds: {a.head}, lufs: {lufs:.1f} }} as const;\n"
        )
    print(f"{a.out}: {os.path.getsize(a.out) / 1e6:.2f} MB, loop {len(x) / sr:.3f}s, {lufs:.1f} LUFS")


main()
