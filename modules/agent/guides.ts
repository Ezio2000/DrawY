import type { Material } from "@drawy/materials/schema";
import { CARD_BUDGET, card } from "../materials/index.ts";
import type { GuideTopic } from "../contracts/index.ts";
import type { Item } from "../models/index.ts";
import { guideSchema, readSchema } from "./tools.ts";

/** The author's instructions for situations only some works meet, read with draw_guide
 * when `when` applies. The system prompt lists each topic's `when` and nothing else, so
 * what a work does not need costs it nothing. No guide names the library's materials: they
 * are found by searching, so the guides stay the same however the library grows. */
export const guides: Record<GuideTopic, { when: string; text: string }> = {
  drawing: {
    when: "before writing a drawing or link drawing of your own, including one that composes library drawings with api.draw",
    text: `A drawing definition is reusable JavaScript function-body source. It receives api and returns an Element (or awaits one), because the runtime places what is returned and reports anything else as an error. Leave out HTML documents, body or head, app chrome and viewport sizing. Use the local module width and height; all positions outside a drawing are scene units. Drawing code is async, so await initial data before returning. Format drawing source and interaction scripts as clean, multi-line JavaScript and SVG with line breaks and readable variable names — never minified or dense one-liners — so users can inspect them in the code panel and later edits can target individual lines cleanly. Reuse one definition across instances with different data.

Drawing API:
- api.data: instance parameters. api.width, api.height: module size. api.theme: the work's style tokens (ink, muted, accent, accent2, paper, stroke, font).
- api.svg('<svg viewBox="0 0 ...">...</svg>') returns an SVG element. api.html('<style>...</style><div>...</div>') returns local DOM. Normal DOM methods and event handlers work.
- api.material(id, {width, height, fit, align, color}) returns a picture material fitted by its visible content into the module or the given box, standing on the box's bottom edge unless align is "center" or "top"; color inks a recolourable icon.
- api.materials[id] gives {url, width, height, anchors} of each picture in the work, for compositions such as <image href> inside your own SVG; anchors are named points normalized to the visible content.
- await api.draw(id, data, {width, height}) returns another drawing's element, the work's own or the library's, sized to the module unless a size is given. Read a library drawing's card with read_materials first.
- api.effect(id) returns "url(#…)" for a filter, fill or marker attribute. await api.mermaid(source) returns a rendered diagram.
- api.emit(event, value) sends an event to the scene interaction. api.animate(seconds => ...) starts a frame loop. api.cleanup(fn) registers cleanup.
- Link drawings also receive api.from and api.to in local coordinates, and api.fromSide and api.toSide, the side of its module each end meets (left, right, top, bottom, or null inside), so a link can leave and arrive square to it.

Values, not code. Read every word, colour, size and picture through api.data, and give the drawing its usual values in defaults: {size: 18, color: "#c4372c"} sits under each module's own data, so one write of defaults changes every module drawn with it, one write of data changes one of them, and neither touches the code. The same values are what people who do not code can change: each default gets a plain control in the editor, chosen from its value. Add params only where a control needs more, by data key: a short label in the user's language, and a type (text; number, with min, max and step for a slider; boolean; color; picture, holding a picture material id; choice, with its options). Words or colours written into the source can be retyped only where they occur once, and those the code computes cannot be changed by hand at all. Give an svg that holds words style="overflow:visible", as the library drawings do, so words a person lengthens run past the module's edge instead of being cut off.

Materials are taken into the work when a drawing or interaction names them literally (api.material(id), api.draw(id), api.effect(id)), a module or link uses one as its drawingId, or a module's data holds their id as a string. List any others in write_work.materials, because an id built at runtime cannot be found by reading the source.

Looks. Use the style's tokens for ink, colours, stroke and font, and its effects for texture, so drawn and pictured parts read as one work. Mark custom pointer controls with data-interactive so the canvas leaves their gestures alone.`,
  },
  diagrams: {
    when: "when the figure is or contains a flowchart, system diagram, hierarchy, matrix, table, chart or other conventional structured form",
    text: `Build a conventional form from the library's drawing for it: find it with find_materials (types ["drawing"]) by the form's name (hierarchy, layers, quadrant, comparison table, pyramid, venn, mind map, steps, swimlanes, fishbone, sequence diagram, concentric circles, gantt, bar chart, donut, gauge, key figure, radar, function plot, timeline, checklist, callout, flowchart node), then read its card with read_materials. They already have balanced spacing, a type scale and the style's colours, which boxes placed by hand rarely reach. Search for every form you expect to use in one call, alongside this guide when you can. They can also be one part of a larger idea, such as a gauge on a drawn machine or a sequence beside the two machines it connects.
Whenever the figure uses one of these forms (as the main diagram or as a part), use the library drawing and add surrounding labels, arrows, pictures or callouts to make it specific, rather than reimplementing it in custom SVG.
Draw a flowchart or system diagram as one node module per block, joined by arrow links with route elbow, with blocks of one kind the same size and aligned on shared rows and columns, so the user can move a block and its connections follow. A node's outline is notation the reader expects, so it is the one box the visual language allows.
Keep api.mermaid for UML class or state diagrams the library does not provide, since its generic look ignores the style. Structure drawings take one of the style's effects as their effect parameter, which gives them the style's texture.`,
  },
  maps: {
    when: "whenever anything is placed on the earth: a march or voyage, where events happened, where something lives or spreads, a trip through a region or a walk through a city",
    text: `Real geography comes from data. Draw the ground as a module of the library's map drawing (find_materials subjects ["geographic map"], types ["drawing"], then read its card): its coastlines, lakes and rivers are real and its places, routes and areas are given in longitude and latitude, so every position and distance is true, while outlines drawn by hand invent the coast and misplace everything on it. Coordinates of well-known places to a hundredth of a degree come from what you know.
This holds down to one city: in a view a couple of hundred kilometres across or less, the map drawing draws OpenStreetMap's real roads and water under the places, and closer in the streets and parks, so a trip through a region or a walk through a town goes on the map with bounds close around its stops.
Those roads and waterways carry their names as the place writes them, in its own language and script. When they are not in the user's language, give the map its names parameter: {name as you see it drawn: the name in the user's language} for the ones the figure needs read, because a reader cannot follow a route along streets they cannot read.
Put what the concept needs on the map itself (one route per stage or force, coloured or sized by what differs between them; areas for territories; dates as notes), and keep pictures and explanations as modules around or over it.
A route runs directly from point to point and knows nothing of the land, so one given only by its ports cuts across peninsulas and islands. For a voyage, add [lon, lat] waypoints in open water around capes and through straits, and for a land journey follow the real valleys, passes or roads, because a reader takes the line as the way that was travelled. Check every leg against the coast when you look.
Today's borders and roads on a historical map are anachronisms, so leave borders off unless they help readers find the places, and then say they are modern; set roads: false to leave today's roads and railways off while keeping the fine coast and water under them.
A map's edge is where the ground was cut. When the map is the figure's ground and fills most of the view, keep the default edge: "frame", which says where the land stops. edge: "fade" hides the outer part of the map and leaves land dissolving into paper, which suits only a small map set among other pictures as a vignette.`,
  },
  exploration: {
    when: "before adding interactive controls, animation, click behaviour, scene interaction scripts or subscenes",
    text: `Exploration keeps the opening canvas clean and lets interested readers dig deeper. Give a module a scene target only when that part deserves its own diagram (empty subscenes can be created for later expansion); use a detail target for HTML prose depth instead of writing sentences on the canvas.

A scene's script is its interaction field, a multi-line JavaScript function body receiving api:
- api.on(moduleId, event, callback) subscribes to module events; drawings send them with api.emit, and the slider and choice library drawings send "change".
- api.set(moduleId, dataPatch) changes instance data. api.move(moduleId, x, y) moves a module and the links on it.
- api.animate(seconds => ...) coordinates animation. api.cleanup(fn) disposes resources.
- api.openScene(id) and api.openDetail(id) navigate. A module target navigates without code.

These states are transient, since the saved work is what reopens, so the default state belongs in instance data. When a control changes values, keep the scales they are read against (axes, reference lines, maxima) fixed over the control's range, so a change shows as a change, with ticks on round numbers. Register async handlers as async functions so preview waits for them.
Give the scene checks [{moduleId, selector}] for the important controls its script or a drawing answers — including buttons, choice items, or a slider's input[type="range"] (which capture clicks away from its current thumb position, so no extra min/max test buttons are needed): view_canvas then shows the changed state. Test a sequence with view_canvas actions in a specified scene, because an interaction you have not seen run is unverified. A module's target needs no check, as the app opens it without your code: view_canvas already shows every subscene, and a detail page is laid out by the app, so a click that opens one is reported in words, not pictured.`,
  },
  formats: {
    when: "when the user names a medium that carries its own words and shape: a poster, flyer, social-media card, cover or slide",
    text: `The scene is that piece, composed to its format, with the headline it would carry. A poster, flyer or phone card is portrait, so size the composition to that shape instead of the landscape view. The rule against drawn titles yields here because the headline is part of the piece; it is still set as modules a person can retype. Follow the conventions of the medium: one message read from a distance on a poster, one idea per slide, the name legible at thumbnail size on a cover. Keep the type large, since these are read at a glance, and let the visual idea take most of the area.`,
  },
  copy: {
    when: "when the user asks to reproduce a picture they gave (一模一样, 复刻, 照着画, 还原)",
    text: `The scene is that picture redrawn as editable modules, at its aspect, with every element it shows in its place, proportions, colours and type: titles and text, frames and cards, background, and the parts cut off at its edges. Never place the given picture itself, because the point is an editable version of it, and leave out nothing it shows. The rules on composition and visual language yield to the reference.
Before finishing, compare the latest view with the reference element by element, top to bottom and edge to edge, and fix whatever is missing or different.`,
  },
};

/** The system prompt's list of guides: each topic with when to read it. */
export const guideIndex = (Object.keys(guides) as GuideTopic[])
  .map((topic) => `- ${topic}: ${guides[topic].when}.`)
  .join("\n");

/** A call's arguments, if they were ones the tool could answer. */
function requested<T>(call: Item, schema: { safeParse: (v: unknown) => { data?: T } }): T | undefined {
  try {
    return schema.safeParse(JSON.parse(call.arguments)).data;
  } catch {
    return undefined;
  }
}
/** What the author has already read and still has above in this conversation: guides by
 * topic and material cards by id. A summary replaces the conversation, and takes these with
 * it. A call refused gave it nothing. `pending` are calls of the batch being run whose
 * results are still to come: a card asked for beside set_brief is read, even though its
 * answer follows the brief's. */
export function guidesRead(input: Item[], pending: Item[] = []) {
  const answered = new Set([
    ...input.filter((i) => i.type === "function_call_output").map((i) => i.call_id),
    ...pending.map((c) => c.call_id),
  ]);
  const outputs = new Map(
    input.flatMap((i) => (i.type === "function_call_output" && typeof i.output === "string" ? [[i.call_id, i.output]] : [])),
  );
  const read = { topics: new Set<string>(), drawings: new Set<string>() };
  for (const item of input) {
    if (item.type !== "function_call" || !answered.has(item.call_id)) continue;
    if (item.name === "draw_guide")
      for (const topic of requested(item, guideSchema)?.topics ?? []) read.topics.add(topic);
    // Cards given with a search's results count as read the same way.
    if (item.name === "read_materials" || (item.name === "find_materials" && outputs.get(item.call_id)?.includes('"cards":'))) {
      // A card counts as read once it was shown: one left out for the budget was not.
      const output = outputs.get(item.call_id);
      const ids =
        item.name === "read_materials"
          ? (requested(item, readSchema)?.ids ?? [])
          : [...(output ?? "").matchAll(/\{\\"id\\":\\"([a-z0-9-]+)\\",\\"version\\"/g)].map((m) => m[1]);
      for (const id of ids)
        if (item.name === "find_materials" || output === undefined || output.includes(`{"id":${JSON.stringify(id)}`))
          read.drawings.add(id);
    }
  }
  return read;
}

/** The answer to draw_guide, as plain text: each guide under its topic. What is already
 * above is named, not repeated: it would only lengthen what every later turn carries. */
export function readGuides(request: { topics: GuideTopic[] }, read: ReturnType<typeof guidesRead>) {
  const above: string[] = [];
  const topics = request.topics.filter((t) => !read.topics.has(t) || !above.push(t));
  return [
    ...topics.map((topic) => `## ${topic}\n${guides[topic].text}`),
    ...(above.length ? [`Already above in this conversation: ${above.join(", ")}.`] : []),
  ].join("\n\n");
}

/** The answer to read_materials: each card as one line of JSON, within a budget. A card
 * already above is named, not repeated; one that does not fit is named to be read again. */
export function readCards(ids: string[], found: Material[], read: ReturnType<typeof guidesRead>) {
  const above: string[] = [];
  const fresh = [...new Set(ids)].filter((id) => !read.drawings.has(id) || !above.push(id));
  const byId = new Map(found.map((m) => [m.id, m]));
  const lines: string[] = [],
    later: string[] = [];
  let spent = 0;
  for (const id of fresh) {
    const m = byId.get(id);
    if (!m) continue;
    const line = JSON.stringify(card(m));
    if (spent + line.length > CARD_BUDGET && lines.length) {
      later.push(id);
      continue;
    }
    spent += line.length;
    lines.push(line);
  }
  const unknown = fresh.filter((id) => !byId.has(id));
  return {
    text: [
      ...(lines.length ? [lines.join("\n")] : []),
      ...(above.length ? [`Already above in this conversation: ${above.join(", ")}.`] : []),
      ...(later.length ? [`Not shown, to keep this answer short: ${later.join(", ")}. Read them in another call.`] : []),
      ...(unknown.length ? [`Not in the library: ${unknown.join(", ")}. Find materials with find_materials.`] : []),
    ].join("\n\n"),
    shown: fresh.filter((id) => byId.has(id) && !later.includes(id)),
  };
}
