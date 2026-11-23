"""One contact sheet per prompt: the before runs in the top row, the after runs below."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

here = os.path.dirname(os.path.abspath(__file__))
prompts = json.load(open(os.path.join(here, "prompts.json")))
before, after = sys.argv[1], sys.argv[2]
out = os.path.join(here, "sheets")
os.makedirs(out, exist_ok=True)
W, H = 640, 400
try:
    font = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 22)
except OSError:
    font = ImageFont.load_default()
for i, p in enumerate(prompts):
    sheet = Image.new("RGB", (W * 3 + 40, H * 2 + 90), "white")
    d = ImageDraw.Draw(sheet)
    d.text((10, 5), f"{i:02d} {p['title']}  上：重构前 {before}   下：重构后 {after}", fill="black", font=font)
    for row, name in enumerate([before, after]):
        for r in range(1, 4):
            path = os.path.join(here, "results", name, f"{i:02d}-r{r}.png")
            x, y = 10 + (r - 1) * (W + 10), 40 + row * (H + 10)
            if os.path.exists(path):
                im = Image.open(path).convert("RGB")
                im.thumbnail((W, H))
                sheet.paste(im, (x, y))
            else:
                d.rectangle([x, y, x + W, y + H], outline="red")
                d.text((x + 20, y + 20), "无图", fill="red", font=font)
    sheet.save(os.path.join(out, f"{i:02d}-{before}-vs-{after}.png"))
print("ok")
