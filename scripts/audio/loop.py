# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "soundfile"]
# ///
"""Cut a seamless loop out of a recording of the music played through more than once.

    uv run scripts/audio/loop.py audio/raw/take.wav --start 52.48 --end 97.61 \\
        --out audio/work/loop.wav --preview 3

--start is the loop's first downbeat and --end the downbeat it comes back round to,
in seconds (analyze.py finds them). Both cuts land a little before their downbeat,
so no attack is clipped, and the seam is a short crossfade from what was ringing at
the end into the head.

A ringing instrument is still sounding when the loop comes round. When --start is the
second time through, the first time through is already ringing under it and there's
nothing more to do. When it's the first, nothing rings under it in the recording, so
--ring-from names a later downbeat where the playing stopped (the last time through
comes back round to it) and the ring-out after it is laid over the head instead.

The loop is scaled so its loudest sample sits at --peak dBFS; levels against the
game's other sounds are for the game's own volume to settle. --preview also writes
the loop played N times over, for hearing the seam.
"""

import argparse

import numpy as np
import soundfile as sf


def main():
    p = argparse.ArgumentParser()
    p.add_argument("file")
    p.add_argument("--start", type=float, required=True)
    p.add_argument("--end", type=float, required=True)
    p.add_argument("--ring-from", type=float)
    p.add_argument("--ring-length", type=float, default=3.0, help="seconds of ring-out to lay over the head")
    p.add_argument("--pre", type=float, default=0.05, help="seconds before each downbeat to cut")
    p.add_argument("--xfade", type=float, default=0.04, help="seconds of crossfade at the seam")
    p.add_argument("--peak", type=float, default=-1.0)
    p.add_argument("--out", required=True)
    p.add_argument("--preview", type=int, default=0)
    a = p.parse_args()

    x, sr = sf.read(a.file, always_2d=True)
    s = lambda t: int(round(t * sr))
    begin, end, fade = s(a.start - a.pre), s(a.end - a.pre), s(a.xfade)
    if fade > s(a.pre):
        p.error("--xfade must fit inside --pre, or the crossfade reaches the downbeat after --end")
    loop = x[begin:end].copy()

    if a.ring_from is not None:
        r = s(a.ring_from - a.pre)
        ring = x[r : r + s(a.ring_length)].copy()
        # Out over the back half, so the end of the take (and whatever noise follows it)
        # never arrives.
        half = len(ring) // 2
        ring[half:] *= np.linspace(1, 0, len(ring) - half)[:, None]
        loop[: len(ring)] += ring

    # The seam: what would have rung on past the end, fading into the head. The two are
    # different sound, not the same sound offset, so the fade keeps their power even.
    t = np.linspace(0, np.pi / 2, fade)[:, None]
    loop[:fade] = loop[:fade] * np.sin(t) + x[end : end + fade] * np.cos(t)

    gain = 10 ** (a.peak / 20) / np.abs(loop).max()
    loop *= gain
    sf.write(a.out, loop, sr, subtype="PCM_24")
    print(f"{a.out}: {len(loop) / sr:.3f}s ({len(loop)} samples), gain {20 * np.log10(gain):+.1f} dB")

    if a.preview:
        out = a.out.rsplit(".", 1)[0] + f"-x{a.preview}.wav"
        sf.write(out, np.tile(loop, (a.preview, 1)), sr, subtype="PCM_24")
        print(f"{out}: {a.preview} times over")


main()
