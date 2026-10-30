import { Canvas } from "../canvas/index.ts";
import { detailElement } from "./detail.ts";
import type { Work, Target } from "../contracts/index.ts";

declare global {
  interface Window {
    drawyData: { work: Work; sceneId: string };
    drawyReady: boolean;
    drawyErrors: string[];
    drawyView: Canvas;
  }
}
window.drawyErrors = [];
window.drawyReady = false;
addEventListener("error", (e) => window.drawyErrors.push(e.message));
addEventListener("unhandledrejection", (e) =>
  window.drawyErrors.push(String(e.reason)),
);
const { work } = window.drawyData;
const stage = document.getElementById("stage")!;
function open(target: Target) {
  if (target.kind === "scene") {
    window.drawyView.dispose();
    const url = new URL(location.href);
    url.pathname = url.pathname.replace(
      /[^/]+$/,
      encodeURIComponent(target.id),
    );
    history.replaceState(null, "", url);
    render(target.id);
  } else {
    const detail = detailElement(work.details[target.id], () =>
      detail.remove(),
    );
    detail.style.cssText =
      "position:fixed;inset:0;overflow:auto;background:#faf9f5;padding:48px max(24px,calc((100vw - 760px)/2));box-sizing:border-box;z-index:10";
    document.body.append(detail);
    window.drawyReady = false;
    void Promise.all([
      document.fonts.ready,
      ...Array.from(detail.shadowRoot!.querySelectorAll("img")).map((img) =>
        img.decode(),
      ),
    ])
      .catch((e) => window.drawyErrors.push(String(e)))
      .finally(() => {
        window.drawyReady = true;
      });
  }
}
function render(sceneId: string) {
  window.drawyData.sceneId = sceneId;
  window.drawyReady = false;
  window.drawyView = new Canvas(stage, work, work.scenes[sceneId], {
    open,
    select: () => {},
    error: (message) => window.drawyErrors.push(message),
  });
  void window.drawyView.ready
    .catch((e) => window.drawyErrors.push(String(e)))
    .finally(() => {
      window.drawyReady = true;
    });
}
render(window.drawyData.sceneId);
