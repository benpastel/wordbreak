#!/bin/sh
# The menu music, from the take to what the game plays. Times are seconds into the
# take. The loop is the second time through: it comes round on a soft low note that
# ends each phrase (52.48 in the first pass; the second pass stops before playing
# it, so its place is 0.73s after the last low note at 96.88, as the first pass
# spaced them) and the file opens on the downbeat after it, at 52.65. Played from
# silence it starts 4ms before that downbeat, past the ring the loop brings round.
set -e
cd "$(dirname "$0")/../.."
mkdir -p audio/work
uv run -q scripts/audio/loop.py audio/source/menu-take7.flac \
  --start 52.48 --end 97.61 --open 52.65 --pre 0.08 --xfade 0.06 \
  --out audio/work/menu-loop.wav --preview 3
uv run -q scripts/audio/encode.py audio/work/menu-loop.wav public/music/menu.mp3 \
  --module src/client/menuMusic.ts --quality 2 --first-note 0.076
