#!/usr/bin/env bash
# Builds out/drawy-60s.mp4 from scratch: frames, score, then the two together at -14 LUFS.
set -euo pipefail
cd "$(dirname "$0")"
FPS="${FPS:-60}"
WORKERS="${WORKERS:-4}"

[ -d node_modules/lxgw-wenkai-webfont ] || npm install
rm -rf out/frames
node render.mjs frames "$FPS" "$WORKERS"
python3 -I audio/score.py out/cues.json out/score.wav

# measure, then normalise linearly to -14 LUFS / -1 dBTP
stats=$(ffmpeg -hide_banner -i out/score.wav -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$stats" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
norm="loudnorm=I=-14:TP=-1:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true"

ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i out/frames/%05d.jpg -i out/score.wav \
  -af "$norm,aresample=48000" \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -tune animation \
  -c:a aac -b:a 256k -shortest -movflags +faststart \
  -metadata title="DrawY · 每个想法，都值得探索" out/drawy-60s.mp4
echo "out/drawy-60s.mp4"
