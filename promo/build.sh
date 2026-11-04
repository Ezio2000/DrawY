#!/usr/bin/env bash
# Builds a film from scratch: frames, score, then the two together at -14 LUFS.
#   ./build.sh          → out/drawy-60s.mp4              (the sixty seconds)
#   ./build.sh touch    → out/touch/drawy-touch-55s.mp4  (《请勿触摸》)
set -euo pipefail
cd "$(dirname "$0")"
FILM="${1:-src}"
FPS="${FPS:-60}"
WORKERS="${WORKERS:-4}"
case "$FILM" in
  src) OUT=out SCORE=audio/score.py NAME=drawy-60s.mp4 TITLE="DrawY · 每个想法，都值得探索" ;;
  touch) OUT=out/touch SCORE=audio/touch.py NAME=drawy-touch-55s.mp4 TITLE="DrawY · 请勿触摸" ;;
  *) echo "unknown film: $FILM (src or touch)" >&2; exit 1 ;;
esac

[ -d node_modules/lxgw-wenkai-webfont ] || npm install
rm -rf "$OUT/frames"
FILM="$FILM" node render.mjs frames "$FPS" "$WORKERS"
python3 -I "$SCORE" "$OUT/cues.json" "$OUT/score.wav"

# measure, then normalise linearly to -14 LUFS / -1 dBTP
stats=$(ffmpeg -hide_banner -i "$OUT/score.wav" -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$stats" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
norm="loudnorm=I=-14:TP=-1:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true"

ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i "$OUT/frames/%05d.jpg" -i "$OUT/score.wav" \
  -vf "scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=full:out_range=tv,format=yuv420p" \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -af "$norm,aresample=48000" \
  -c:v libx264 -preset slow -crf 17 -profile:v high -tune animation \
  -c:a aac -b:a 256k -shortest -movflags +faststart \
  -metadata title="$TITLE" "$OUT/$NAME"
echo "$OUT/$NAME"
