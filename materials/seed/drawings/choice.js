// A row of options of which one is chosen: seasons, stages, modes, steps of a story. It
// marks its own choice and sends "change" with the chosen option and its index.
const d = api.data,
  t = api.theme;
const options = (d.options || []).map(String);
const color = d.color || t.accent || "#d97757";
let chosen = Math.max(0, options.indexOf(String(d.value ?? options[0])));
const root = api.html(`<style>
  .c{display:flex;align-items:center;justify-content:center;gap:6px;height:100%;flex-wrap:wrap;font-size:${Number(d.size ?? 15)}px}
  button{border:1.5px solid ${color};background:transparent;color:${color};border-radius:999px;padding:.35em 1em;cursor:pointer;font:inherit}
  button[aria-pressed=true]{background:${color};color:${t.paper || "#fff"}}
</style><div class="c" data-interactive></div>`);
const row = root.querySelector(".c");
const buttons = options.map((label, i) => {
  const b = document.createElement("button");
  b.textContent = label;
  b.dataset.option = String(i);
  b.addEventListener("click", () => {
    chosen = i;
    buttons.forEach((x, j) =>
      x.setAttribute("aria-pressed", String(j === chosen)),
    );
    void api.emit("change", { option: label, index: i });
  });
  row.append(b);
  return b;
});
buttons.forEach((x, j) => x.setAttribute("aria-pressed", String(j === chosen)));
return root;
