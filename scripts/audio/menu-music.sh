#!/bin/sh
# The menu music, from the take to what the game plays. Times are seconds into the
# take: the second time through starts at 52.48 (a soft note just before the loud
# one) and would come round again at 97.61, the first pass's 0.73s from its last
# low note to the next downbeat, after the second pass's last low note at 96.88.
set -e
cd "$(dirname "$0")/../.."
mkdir -p audio/work
uv run -q scripts/audio/loop.py audio/source/menu-take7.flac \
  --start 52.48 --end 97.61 --pre 0.1 --xfade 0.08 \
  --out audio/work/menu-loop.wav --preview 3
uv run -q scripts/audio/encode.py audio/work/menu-loop.wav public/music/menu.mp3 \
  --module src/client/menuMusic.ts --quality 2
