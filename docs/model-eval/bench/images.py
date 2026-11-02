"""Report pictures from the benchmark's run folders.

    python3 -I docs/model-eval/bench/images.py docs/model-eval/runs/baseline docs/model-eval/img [prefix]

For every run: two in-progress frames taken at the same share of each run's own length
(a third and two thirds through, so slow and fast models line up by stage, not by clock),
the finished page as the user saw it, and the exported scene. Each is a WebP the report
can show side by side, with the seconds into the run in its file name's companion JSON.
"""
import json
import sys
from pathlib import Path

from PIL import Image

runs, out = Path(sys.argv[1]), Path(sys.argv[2])
prefix = sys.argv[3] if len(sys.argv) > 3 else ""
out.mkdir(parents=True, exist_ok=True)


def save(src: Path, dst: Path, width: int) -> None:
    im = Image.open(src).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(dst, "WEBP", quality=78, method=6)


index = {}
for result_file in sorted(runs.glob("*/result.json")):
    r = json.loads(result_file.read_text())
    run_dir = result_file.parent
    name = f"{prefix}{r['prompt']}-{r['model']}"
    shots = {}
    frames = [f for f in r.get("frames", []) if (run_dir / f["file"]).exists()]
    total = (r.get("wallMs") or 0) / 1000
    for label, share in (("a", 1 / 3), ("b", 2 / 3)):
        if not frames or not total:
            continue
        frame = min(frames, key=lambda f: abs(f["at"] - total * share))
        save(run_dir / frame["file"], out / f"{name}-{label}.webp", 720)
        shots[label] = frame["at"]
    if (run_dir / "final.png").exists():
        save(run_dir / "final.png", out / f"{name}-final.webp", 720)
        shots["final"] = round(total)
    for picture in r.get("pictures", []):
        scene = picture.removeprefix("scene-").removesuffix(".png")
        save(run_dir / picture, out / f"{name}-scene-{scene}.webp", 1200)
        shots.setdefault("scenes", []).append(scene)
    index[name] = shots

(out / f"{prefix}index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
print(json.dumps(index, ensure_ascii=False))
