import { Canvas } from "../canvas/index.ts";
import { detailElement } from "./detail.ts";
import type { Work, Target } from "../contracts/index.ts";

declare global {
  interface Window {
    drawyData: { work: Work; sceneId: string };
    drawyReady: boolean;
    drawyErrors: string[];
    drawyView: Canvas;
    /** Opens a scene of the work, for a page around the drawing to move between them. */
    drawyOpen: (sceneId: string) => void;
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
    // A page opened from a file cannot change its address; the scene still opens.
    try {
      history.replaceState(null, "", url);
    } catch {}
    render(target.id);
  } else {
    // The page covers the drawing; the article inside keeps its own measure, as in the app.
    // Padding on the article itself would come out of that measure and squeeze it.
    const page = document.createElement("div");
    page.dataset.drawyDetail = target.id;
    page.style.cssText =
      "position:fixed;inset:0;overflow:auto;background:#fff;padding:48px 24px 96px;box-sizing:border-box;z-index:10";
    const detail = detailElement(work.details[target.id], () => page.remove());
    page.append(detail);
    document.body.append(page);
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
  dispatchEvent(new CustomEvent("drawy:scene", { detail: sceneId }));
  window.drawyReady = false;
  window.drawyView = new Canvas(stage, work, work.scenes[sceneId], {
    marks: false,
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
window.drawyOpen = (id) => {
  if (!work.scenes[id] || id === window.drawyData.sceneId) return;
  window.drawyView.dispose();
  render(id);
};
render(window.drawyData.sceneId);
