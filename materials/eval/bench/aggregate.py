"""Aggregates the before/after real-model runs: per prompt and overall means."""
import json, glob, os, statistics as st, sys

here = os.path.dirname(os.path.abspath(__file__))
prompts = json.load(open(os.path.join(here, "prompts.json")))


def load(name):
    rows = []
    for f in sorted(glob.glob(os.path.join(here, "results", name, "[0-9]*-r*.json"))):
        d = json.load(open(f))
        s = d["summary"]
        run = d["run"]
        u = s.get("usage") or {}
        pr = run.get("prices") or {}
        img = (u.get("images") or {})
        cost_img = 0
        if pr.get("image") and img:
            p = pr["image"]
            cost_img = img.get("count", 0) * p.get("image", 0) + (
                (img.get("textInput", img.get("input", 0) - img.get("imageInput", 0))) * p.get("textInput", 0)
                + img.get("imageInput", 0) * p.get("imageInput", 0)
                + (img.get("output", 0) - img.get("textOutput", 0)) * p.get("output", 0)
                + img.get("textOutput", 0) * p.get("textOutput", 0)
            ) / 1e6
        tool_errors = sum(1 for x in run["steps"] if x["kind"] == "tool" and x["status"] == "failed")
        mats = [x for x in run["steps"] if x["kind"] == "tool" and x.get("name") in ("find_materials", "read_materials", "draw_guide")]
        rows.append({
            "prompt": int(s["tag"][:2]),
            "status": s["status"],
            "elapsed": (s.get("elapsedMs") or 0) / 1000,
            "firstScene": (s.get("firstSceneMs") or 0) / 1000,
            "tools": s["turns"],
            "toolErrors": tool_errors,
            "input": u.get("input", 0),
            "uncached": u.get("input", 0) - u.get("cached", 0),
            "output": u.get("output", 0),
            "author$": s.get("authorCost") or 0,
            "image$": cost_img,
            "findCalls": s["tools"].get("find_materials", 0),
            "readCalls": s["tools"].get("read_materials", 0) + s["tools"].get("draw_guide", 0),
            "generated": s.get("generatedPictures", 0),
            "libPictures": len(s.get("libraryPictures", [])),
            "libDrawings": len([x for x in s.get("libraryDrawings", []) if x not in ("label", "picture", "arrow")]),
            "views": s["tools"].get("view_canvas", 0),
        })
    return rows


def mean(rows, k):
    v = [r[k] for r in rows]
    return st.mean(v) if v else 0


def table(names):
    keys = ["elapsed", "firstScene", "tools", "toolErrors", "input", "uncached", "output", "author$", "image$",
            "findCalls", "readCalls", "generated", "libPictures", "libDrawings", "views"]
    data = {n: load(n) for n in names}
    out = {"overall": {}, "perPrompt": {}}
    for n, rows in data.items():
        out["overall"][n] = {"runs": len(rows), "completed": sum(r["status"] == "completed" for r in rows),
                             **{k: round(mean(rows, k), 4) for k in keys}}
    for i, p in enumerate(prompts):
        out["perPrompt"][p["title"]] = {n: {k: round(mean([r for r in rows if r["prompt"] == i], k), 3) for k in
                                            ["elapsed", "tools", "input", "output", "author$", "libDrawings", "libPictures", "generated"]}
                                        for n, rows in data.items()}
    return out


if __name__ == "__main__":
    print(json.dumps(table(sys.argv[1:] or ["base", "new"]), ensure_ascii=False, indent=1))
