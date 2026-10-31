# DrawY · 60 秒宣传片

一支铅笔的一分钟：脑子里的一团乱线被拉直成输入框，DrawY 先听懂、再一笔一笔起稿，草稿像照片一样显影；它看一眼自己的画再改好；点开地球钻进水循环，再钻进一片叶子；同一个苹果换七种画风；镜头拉远，所有作品铺成一面墙，正中的白纸上，铅笔画出灯笼，火苗亮起——DrawY。

整部片子是一个 HTML 时间线，每一帧都是时间的纯函数 `render(t)`，用 Playwright 逐帧截图；配乐与音效由 `audio/score.py` 用 numpy 从零合成（D 大调、96 BPM，24 小节恰好 60 秒，每个小节线都落在剪辑点上），音效按时间线导出的提示表（`cues.json`）逐个对位。画面中的插画都取自 `materials/seed` 素材库。

| 时间 | 段落 | 画面 |
| --- | --- | --- |
| 0–7 s | 乱线 | 铅笔乱画出一团线，问号冒出，乱线被拉直成首页输入框 |
| 7–10 s | 说给 DrawY 听 | 打字“太阳系是如何运转的？”，发送 |
| 10–17 s | 先听懂，再动笔 | 便签上写下创作简报，铅笔用石墨线起稿、写上名字、排阴影 |
| 17–22 s | 显影 | 图片像照片一样显影，轨道沿路径勾出，名字逐字写出，行星开始公转 |
| 22–27 s | 再看一遍 | 取景框查看画布，圈出“太小了，看不清”，地球放大、添上月球 |
| 27–39 s | 点开 | 点击地球穿过“传送门”进入水循环，再点树进入光合作用，场景路径随之延长 |
| 39–45 s | 十种画风 | 甩镜进入苹果，按拍子换七种画风，再排成一排 |
| 45–50 s | 好奇什么就画什么 | 大模型、心脏、丝绸之路、红楼梦人物关系依次画出 |
| 50–54 s | 一面墙 | 镜头拉远，所有作品铺满一面墙，正中留着一张白纸 |
| 54–60 s | 点灯 | 铅笔画出灯笼，火苗亮起：DrawY · 每个想法，都值得探索 |

## 生成

需要 Node、Python 3（numpy、scipy）、ffmpeg 和 Playwright 自带的 Chromium。

一键生成：`promo/build.sh`（帧 → 配乐 → 按 -14 LUFS 线性标准化 → H.264/AAC，BT.709）。分步：

```sh
cd promo
npm install                         # 字体：霞鹜文楷、思源宋体/黑体、Instrument Serif、Fraunces
node render.mjs stills 12 24.3 55.5 # 渲染几张静帧到 out/stills
node render.mjs frames 60 4         # 60 fps，4 个页面并行，帧写到 out/frames，提示表写到 out/cues.json
python3 audio/score.py out/cues.json out/score.wav
ffmpeg -framerate 60 -i out/frames/%05d.jpg -i out/score.wav \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -c:a aac -b:a 256k \
  -af loudnorm=I=-14:TP=-1:LRA=11 -shortest -movflags +faststart out/drawy-60s.mp4
```

在浏览器里直接打开 `src/index.html`（需从仓库根目录起一个静态服务）会实时播放；`?t=秒` 停在某一帧，`?from=秒` 从某处开始播放。

## 文件

- `src/main.js` 时间线：开场乱线、输入框、各镜头的摄像机、俯冲转场、作品墙与灯笼落版
- `src/drawings.js` 片中的作品，每幅都按自己的本地时间画出来，也能以完成状态再画一次放上墙
- `src/hud.js` 屏幕层：铅笔、光标、字幕、取景框、品牌的灯笼与火花
- `src/lib.js` 缓动、手绘线条、自画的路径与文字、显影、提示表
- `audio/score.py` 配乐与音效
