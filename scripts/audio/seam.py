# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "soundfile"]
# ///
"""Short clips for judging loops by ear: each loop's end running into its start, and
its start alone as it plays from silence, all on one page to click through.

    uv run scripts/audio/seam.py audio/work/gap-*.wav --page audio/work/seams.html

Each clip is written beside its loop (name-seam.wav, name-start.wav).
"""

import argparse
import html
import os

import numpy as np
import soundfile as sf


def main():
    p = argparse.ArgumentParser()
    p.add_argument("loops", nargs="+")
    p.add_argument("--seconds", type=float, default=4.0)
    p.add_argument("--page", required=True)
    a = p.parse_args()

    rows = []
    for path in a.loops:
        x, sr = sf.read(path, always_2d=True)
        n = int(a.seconds * sr)
        base = path.rsplit(".", 1)[0]
        sf.write(base + "-seam.wav", np.concatenate([x[-n:], x[:n]]), sr, subtype="PCM_24")
        sf.write(base + "-start.wav", x[:n], sr, subtype="PCM_24")
        rows.append((os.path.basename(base), base + "-seam.wav", base + "-start.wav"))

    rel = lambda f: html.escape(os.path.relpath(f, os.path.dirname(a.page)))
    with open(a.page, "w") as f:
        f.write(
            "<!doctype html><meta charset=utf-8><title>Seams</title>"
            "<style>body{font:15px system-ui;margin:32px;background:#fbf9f5;color:#1c1a17}"
            "table{border-collapse:collapse}td{padding:6px 14px 6px 0}th{text-align:left;font-weight:600;padding-right:14px}"
            "@media(prefers-color-scheme:dark){body{background:#1c1a17;color:#eee}}</style>"
            "<table><tr><th></th><th>seam</th><th>start</th></tr>"
        )
        for name, seam, start in rows:
            f.write(
                f"<tr><th>{html.escape(name)}</th>"
                f"<td><audio controls preload=auto src='{rel(seam)}'></audio></td>"
                f"<td><audio controls preload=auto src='{rel(start)}'></audio></td></tr>"
            )
        f.write("</table>")
    print(a.page)


main()
