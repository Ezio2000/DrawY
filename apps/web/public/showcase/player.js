/* Playback bridge for the real, exported DrawY works on the home page.
   It only accepts messages from its embedding page and runs in an opaque-origin iframe. */
(() => {
  let playing = false;
  window.drawyShowcase = {
    get playing() {
      return playing;
    },
  };
  const notify = (type) => parent.postMessage({ type }, "*");
  addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.type !== "drawy:showcase-play")
      return;
    playing = event.data.playing === true;
    document.documentElement.dataset.playing = String(playing);
    for (const animation of document.getAnimations())
      if (!animation.id.startsWith("drawy-journey-"))
        playing ? animation.play() : animation.pause();
  });
  addEventListener("pointerdown", () => notify("drawy:showcase-explore"));
  addEventListener("keydown", () => notify("drawy:showcase-explore"));
  // Stop the works' own time, rather than covering a still-running work with a picture.
  const clock = `const __homeAnimate = api.animate;
api.animate = callback => {
  let previous = 0, elapsed = 0, rendered = false;
  __homeAnimate(seconds => {
    if (window.drawyShowcase.playing) elapsed += Math.max(0, seconds - previous);
    previous = seconds;
    if (window.drawyShowcase.playing || !rendered) {
      callback(elapsed);
      rendered = true;
    }
  });
};\n`;
  for (const drawing of Object.values(window.drawyData.work.drawings))
    drawing.source = clock + drawing.source;
  for (const scene of Object.values(window.drawyData.work.scenes))
    if (scene.interaction) scene.interaction = clock + scene.interaction;
  const ready = () => {
    if (window.drawyReady) {
      if (!window.drawyErrors.length) {
        // A showcase has no canvas toolbar or composer inside it; use the whole sheet.
        const modules =
          window.drawyData.work.scenes[window.drawyData.sceneId].modules;
        const boxes = modules.map(module => module.bounds);
        const left = Math.min(...boxes.map((b) => b.x));
        const top = Math.min(...boxes.map((b) => b.y));
        const right = Math.max(...boxes.map((b) => b.x + b.width));
        const bottom = Math.max(...boxes.map((b) => b.y + b.height));
        const frame = () => {
          const stage = document.getElementById("stage");
          const region = window.drawyShowcase.bounds ?? { x: left, y: top, width: right - left, height: bottom - top };
          const padding = window.drawyShowcase.bounds ? 16 : 32;
          const ratio = stage.clientWidth / stage.clientHeight;
          const width = Math.max(
            region.width + padding,
            (region.height + padding) * ratio,
          );
          const height = width / ratio;
          window.drawyView.crop({
            x: region.x + (region.width - width) / 2,
            y: region.y + (region.height - height) / 2,
            width,
            height,
          });
        };
        window.drawyShowcase.frame = frame;
        frame();
        new ResizeObserver(frame).observe(document.getElementById("stage"));
        const clean = document.createElement("style");
        clean.textContent = "[data-canvas]{background-image:none!important}";
        document.head.append(clean);
        notify("drawy:showcase-ready");
      }
    } else requestAnimationFrame(ready);
  };
  requestAnimationFrame(ready);
})();
