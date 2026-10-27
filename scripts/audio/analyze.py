# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy", "soundfile"]
# ///
"""A look at a recording without listening to it: format and levels, where the
playing starts and stops, and every note's onset with a rough pitch.

    uv run scripts/audio/analyze.py audio/raw/take.wav
    uv run scripts/audio/analyze.py audio/raw/take.wav --zoom 51.0 53.2

--zoom prints the level every 10ms across a stretch instead, for placing a cut.
Pitches come from the loudest partial just after each onset, so on a ringing
instrument they're a hint, not a transcription.
"""

import argparse

import numpy as np
import soundfile as sf
from scipy.signal import find_peaks

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def db(v):
    return 20 * np.log10(np.maximum(v, 1e-12))


def envelope(m, sr, step=0.01):
    h = int(sr * step)
    n = len(m) // h
    return db(np.sqrt((m[: n * h].reshape(n, h) ** 2).mean(1)))


def onsets(m, sr):
    n, hop = 2048, 480
    win = np.hanning(n)
    frames = np.array([np.abs(np.fft.rfft(win * m[i : i + n])) for i in range(0, len(m) - n, hop)])
    flux = np.maximum(np.diff(np.log1p(frames * 10), axis=0), 0).sum(1)
    peaks, _ = find_peaks(flux, height=np.percentile(flux, 97), distance=int(0.12 * sr / hop))
    return (peaks + 1) * hop / sr


def pitch(m, sr, t):
    i = int((t + 0.05) * sr)
    seg = m[i : i + 8192]
    if len(seg) < 8192:
        return "?"
    spec = np.abs(np.fft.rfft(seg * np.hanning(8192)))
    f = np.fft.rfftfreq(8192, 1 / sr)
    band = (f > 60) & (f < 1500)
    midi = 69 + 12 * np.log2(f[band][np.argmax(spec[band])] / 440)
    k = int(round(midi))
    return f"{NAMES[k % 12]}{k // 12 - 1}{(midi - k) * 100:+.0f}c"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("file")
    p.add_argument("--zoom", nargs=2, type=float, metavar=("FROM", "TO"))
    a = p.parse_args()

    x, sr = sf.read(a.file, always_2d=True)
    m = x.mean(1)

    if a.zoom:
        lo, hi = a.zoom
        env = envelope(m[int(lo * sr) : int(hi * sr)], sr)
        for k in range(0, len(env), 10):
            print(f"{lo + k / 100:7.2f} " + " ".join(f"{v:4.0f}" for v in env[k : k + 10]))
        return

    info = sf.info(a.file)
    print(f"{info.samplerate} Hz, {info.channels} ch, {info.subtype}, {len(m) / sr:.2f}s")
    print("peak dBFS: " + ", ".join(f"{db(np.abs(x[:, c]).max()):.1f}" for c in range(x.shape[1])))
    if x.shape[1] == 2:
        print(f"L/R correlation: {np.corrcoef(x[:, 0], x[:, 1])[0, 1]:.2f}")

    env = envelope(m, sr)
    floor = np.percentile(env, 2)
    print(f"noise floor: {floor:.0f} dBFS")
    # Stretches of sound, a half-second at a time, so talking and handling noise show
    # up apart from the playing.
    half = np.array([np.median(env[k : k + 50]) for k in range(0, len(env), 50)]) > floor + 25
    edges = np.flatnonzero(np.diff(np.r_[0, half.astype(int), 0]))
    for lo, hi in zip(edges[::2], edges[1::2]):
        print(f"sound from {lo / 2:.1f}s to {hi / 2:.1f}s")

    print("onsets:")
    for t in onsets(m, sr):
        print(f"  {t:7.2f}  {env[min(int(t * 100) + 3, len(env) - 1)]:4.0f} dB  {pitch(m, sr, t)}")


main()
