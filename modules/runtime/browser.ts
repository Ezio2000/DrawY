import mermaid from "mermaid";
declare global {
  interface Window {
    drawyReady: boolean;
    drawyErrors: string[];
    drawyData: {
      diagrams: { id: string; format: string; source: string }[];
      readOnly: boolean;
    };
    drawy: {
      pending: Promise<unknown>[];
      waitUntil: (promise: Promise<unknown>) => void;
    };
  }
}
window.drawyReady = false;
window.drawyErrors = [];
window.addEventListener("error", (e) => window.drawyErrors.push(e.message));
window.addEventListener("unhandledrejection", (e) =>
  window.drawyErrors.push(String(e.reason)),
);
const send = (value: object) =>
  parent.postMessage({ drawy: true, ...value }, location.origin);
let diagramSequence = 0;
async function mount() {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "neutral",
  });
  for (const d of window.drawyData.diagrams) {
    const el = document.querySelector(
      `[data-drawy-diagram="${CSS.escape(d.id)}"]`,
    );
    if (!el) continue;
    try {
      if (d.format === "mermaid") {
        const r = await mermaid.render(
          "drawy-diagram-" + ++diagramSequence,
          d.source,
        );
        el.innerHTML = r.svg;
        r.bindFunctions?.(el as HTMLElement);
      } else {
        const r = await fetch("/api/plantuml", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: d.source }),
        });
        if (!r.ok) throw new Error(await r.text());
        el.innerHTML = await r.text();
      }
    } catch (e) {
      window.drawyErrors.push(String(e));
      el.textContent = String(e);
    }
  }
  await Promise.all(
    window.drawy.pending.map((p) =>
      p.catch((error) => {
        window.drawyErrors.push(String(error));
      }),
    ),
  );
  await document.fonts.ready;
  await Promise.all(
    [...document.images].map((i) =>
      i.complete
        ? Promise.resolve()
        : new Promise<void>((r) => {
            i.onload = () => r();
            i.onerror = () => {
              window.drawyErrors.push("图片加载失败 " + i.src);
              r();
            };
          }),
    ),
  );
  window.drawyReady = true;
  send({ type: "ready" });
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", () => void mount());
else void mount();
document.addEventListener("click", (e) => {
  const el = e.target as Element;
  const hot = el.closest("[data-drawy-open]");
  if (hot) {
    e.preventDefault();
    if (parent === window) {
      const url = new URL(location.href);
      url.pathname = url.pathname.replace(
        /[^/]+$/,
        encodeURIComponent(hot.getAttribute("data-drawy-open")!),
      );
      location.href = url.href;
      return;
    }
    send({
      type: "open",
      id: hot.getAttribute("data-drawy-open"),
      title: hot.textContent?.trim(),
    });
    return;
  }
  if (window.drawyData.readOnly) return;
  const selected = el.closest("[data-drawy-id]");
  if (selected) {
    document
      .querySelector("[data-drawy-selected]")
      ?.removeAttribute("data-drawy-selected");
    selected.setAttribute("data-drawy-selected", "");
    send({
      type: "select",
      id: selected.getAttribute("data-drawy-id"),
      text: selected.textContent?.slice(0, 1000),
    });
  }
});
window.addEventListener("scroll", () => send({ type: "scroll", y: scrollY }), {
  passive: true,
});
