// A labelled slider for one quantity. It keeps its own position while dragged and sends
// "change" with the number; the scene interaction listens with api.on(id, "change", v => …).
const d = api.data,
  t = api.theme;
const min = Number(d.min ?? 0),
  max = Number(d.max ?? 100);
const step = Number(d.step ?? (max - min) / 100);
const digits = Number(
  d.digits ?? Math.max(0, -Math.floor(Math.log10(step || 1))),
);
const color = d.color || t.accent || "#d97757";
const show = (v) => `${Number(v).toFixed(digits)}${d.unit ? " " + d.unit : ""}`;
const root = api.html(`<style>
  .s{display:flex;flex-direction:column;justify-content:center;gap:8px;height:100%;font-size:${Number(d.size ?? 15)}px;color:${t.ink || "#222"}}
  .top{display:flex;justify-content:space-between;align-items:baseline}
  .v{font-weight:600;color:${color};font-variant-numeric:tabular-nums}
  input{width:100%;margin:0;accent-color:${color};cursor:pointer}
</style><div class="s" data-interactive><div class="top"><span></span><span class="v"></span></div><input type="range"></div>`);
const input = root.querySelector("input");
Object.assign(input, { min, max, step, value: Number(d.value ?? min) });
input.setAttribute("aria-label", String(d.label ?? ""));
root.querySelector(".top span").textContent = d.label ?? "";
const value = root.querySelector(".v");
value.textContent = show(input.value);
input.addEventListener("input", () => {
  value.textContent = show(input.value);
  void api.emit("change", Number(input.value));
});
return root;
