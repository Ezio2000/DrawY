import type { DrawingMaterial, Material } from "@drawy/materials/schema";
import { drawingCard } from "../materials/index.ts";
import type { GuideTopic } from "../contracts/index.ts";
import type { Item } from "../models/index.ts";
import { guideSchema } from "./tools.ts";

/** The shape of a write that builds a figure of parts and lines without coordinates, shown
 * in the diagrams guide. The tests hold it to the schema. */
export const DIAGRAM_EXAMPLE = {
  style: { route: "elbow", flow: "down" },
  arrange: [{ layout: "flow", frames: { backend: ["orders", "orders-db"] } }],
  modules: [
    { id: "backend", drawingId: "frame", data: { title: "后端" } },
    { id: "submit", drawingId: "node", data: { title: "提交订单", shape: "pill" } },
    { id: "in-stock", drawingId: "node", data: { title: "库存足够？", shape: "diamond" } },
    { id: "orders", drawingId: "node", data: { title: "订单服务" } },
    { id: "orders-db", drawingId: "node", data: { title: "订单库", shape: "cylinder" } },
    { id: "sold-out", drawingId: "node", data: { title: "提示售罄", shape: "pill" } },
  ],
  links: [
    { from: "submit", to: "in-stock" },
    { from: "in-stock", to: "orders", data: { label: "是" } },
    { from: "in-stock", to: "sold-out", data: { label: "否" } },
    { from: "orders", to: "orders-db" },
  ],
};

/** The author's instructions for situations only some works meet, read with draw_guide
 * when `when` applies. The system prompt lists each topic's `when` and nothing else, so
 * what a work does not need costs it nothing. `cards` come along with the topic, because
 * its rules are about using those drawings. */
export const guides: Record<GuideTopic, { when: string; cards?: string[]; text: string }> = {
  drawing: {
    when: "before writing a drawing or link drawing of your own, including one that composes library drawings with api.draw",
    text: `A drawing definition is reusable JavaScript function-body source. It receives api and returns an Element (or awaits one), because the runtime places what is returned and reports anything else as an error. Leave out HTML documents, body or head, app chrome and viewport sizing. Use the local module width and height; all positions outside a drawing are scene units. Drawing code is async, so await initial data before returning. Keep the source readable, and reuse one definition across instances with different data.

Drawing API:
- api.data: instance parameters. api.width, api.height: module size. api.theme: the work's style tokens (ink, muted, accent, accent2, paper, stroke, font).
- api.svg('<svg viewBox="0 0 ...">...</svg>') returns an SVG element. api.html('<style>...</style><div>...</div>') returns local DOM. Normal DOM methods and event handlers work.
- api.material(id, {width, height, fit, align, color}) returns a picture material fitted by its visible content into the module or the given box, standing on the box's bottom edge unless align is "center" or "top"; color inks a recolourable icon.
- api.materials[id] gives {url, width, height, anchors} of each picture in the work, for compositions such as <image href> inside your own SVG; anchors are named points normalized to the visible content.
- await api.draw(id, data, {width, height}) returns another drawing's element, the work's own or the library's, sized to the module unless a size is given. Read a library drawing's card first.
- api.effect(id) returns "url(#…)" for a filter, fill or marker attribute. await api.mermaid(source) returns a rendered diagram.
- api.connect(boxes, lines) runs lines between parts of one drawing, clear of its other parts: boxes is {name: {x, y, width, height}} for every part, in the drawing's own units, and lines is [{from, to, label?, size?}] by those names. Each line comes back as {path, tip, heading, label} (undefined for a name that is not there): path is SVG path data, tip and heading place a mark at its end, and label is where its words have room. Use it for any line across a drawing's own layout, such as a relation between two branches of a tree, since a curve you compute yourself runs through whatever parts stand between.
- api.emit(event, value) sends an event to the scene interaction. api.animate(seconds => ...) starts a frame loop. api.cleanup(fn) registers cleanup.
- Link drawings also receive api.route, where the scene has worked out that this link runs: {kind, points, label}, points in local coordinates from its start to its end (for an elbow the turns between them, already clear of the other modules and of the other links' lanes) and label the place found for its words. Draw along those points and put marks at their two ends; api.from, api.to, api.fromSide and api.toSide give the ends and the side of its module each meets (left, right, top, bottom, or null inside). The scene reads how to route a link from its data, by the keys arrow uses (route, bend, trunk, label, size, labelAt), so keep those names, and compute no path of your own: one written into the code stays behind when the user drags a module. Most link drawings are better made as a copy of arrow (from: "arrow") with other defaults.

Values, not code. Read every word, colour, size and picture through api.data, and give the drawing its usual values in defaults: {size: 18, color: "#c4372c"} sits under each module's own data, so one write of defaults changes every module drawn with it, one write of data changes one of them, and neither touches the code. The same values are what people who do not code can change: each default gets a plain control in the editor, chosen from its value. Add params only where a control needs more, by data key: a short label in the user's language, and a type (text; number, with min, max and step for a slider; boolean; color; picture, holding a picture material id; choice, with its options). Words or colours written into the source can be retyped only where they occur once, and those the code computes cannot be changed by hand at all. Give an svg that holds words style="overflow:visible", as the library drawings do, so words a person lengthens run past the module's edge instead of being cut off.

Materials are taken into the work when a drawing or interaction names them literally (api.material("apple"), api.draw("arrow"), api.effect("pencil-grain")), a module or link uses one as its drawingId, or a module's data holds their id as a string. List any others in write_work.materials, because an id built at runtime cannot be found by reading the source.

Looks. Use the style's tokens for ink, colours, stroke and font, and its effects for texture, so drawn and pictured parts read as one work. Mark custom pointer controls with data-interactive so the canvas leaves their gestures alone.`,
  },
  diagrams: {
    when: "when the figure is or contains a flowchart, swimlanes, an architecture or system diagram, UML (sequence, state machine, class), an ER diagram, a dependency graph, a tree, a mind map, a matrix, table, chart or other conventional structured form",
    text: `Structured figures come in two kinds, built differently.

A form with one fixed shape is a single library drawing: sequence (a UML sequence diagram, with alt and loop fragments, activation bars and notes), hierarchy and mindmap (their relations join two nodes across the branches), layers, quadrant, compare, pyramid, venn, steps, fishbone, concentric, gantt, bars, donut, gauge, stat, radar, checklist, callout. They carry balanced spacing, a type scale and the style's colours, which parts placed by hand rarely reach. Each takes a list or record in its own form, so ask for the card of the one you use in the same draw_guide call as this guide. They can also be one part of a larger idea, such as a gauge on a drawn machine or a sequence beside the two machines it connects.

A figure of parts joined by lines (a flowchart, swimlanes, an architecture, a state machine, an ER or class diagram, a dependency graph, and a tree or mind map whose nodes should move one by one) is built from modules and links, so the user can drag any part and its lines follow.
- Parts. node is a block, and its shape says its kind: box a step or component, pill a start, an end or a state, diamond a decision, cylinder a store, queue, document, parallelogram input or output, note a remark; initial and final are a state machine's dots. entity is a table of fields or a UML class: {name, rows: [{name, type, key: "pk" | "fk" | "uk"}]}, with "---" among the rows as the rule between a class's attributes and methods. frame is a named container round a group: a tier, a subsystem, a boundary. swimlanes is the ground of a cross-functional process, its steps node modules over it. label is for free words. These five and arrow need no card: # Library lists their parameters with every choice. A node's or entity's outline is notation the reader expects, so it is the box the visual language allows.
- Lines. Every line is a link drawn by arrow. Set the work's style tokens once, style: {"route": "elbow", "flow": "down"} (or "right"): each link then runs at right angles and with the reading direction, without data of its own. The scene routes all links together, and again whenever a module moves: round the modules in the way, each with a port of its own on the side it meets and a lane of its own where several share a channel, its label where there is room. Notation is the head and the tail: filled or open arrowheads; triangle for inheritance, diamond and diamond-filled for aggregation and composition; one, only-one, many, one-many, zero-one, zero-many for ER cardinality, usually at both ends; head "none" for a plain line. A link from a module to itself draws a loop. route "smooth" suits the branches of a tree or mind map, and trunk: true lets the links leaving one side share a port, as an org chart's do. Do not write a link drawing to dodge a module, to bend a certain way or to carry a mark of notation: an offset written into code stays behind when the user drags a module, while a routed line follows.
- Places. Leave bounds out of these modules and add arrange to the write: it ranks them by their links, sizes blocks and tables to their words and saves plain bounds. Let it do the sizing (blocks of one kind come out alike): a fixed size too small for a name breaks the name in the middle of a word. {"layout": "flow"} suits most figures, and its direction follows the flow token. Give tiers, [[ids of the first rank], [of the second], …], when the figure names its own ranks, as the layers of an architecture or of a dependency graph do. frames, {frameId: [member ids]}, sizes each frame round its members. {"layout": "lanes", "ground": the swimlanes module, "lanes": [[ids of the first lane], …]} lays out swimlanes. {"layout": "tree"} is an org chart, and with "direction": "both" a mind map. {"layout": "grid", "columns": n} is a matrix of equal things, and "beside": [moduleId, side] sets a second arrangement next to what the first placed. After adding parts or changing type sizes, place them again with "modules": "all" (or the ids) and "fit": true.
- Many parts. Keep each record small, because a write of a hundred blocks is slow in proportion to its length. Values every block shares belong in one drawing copied from the library, drawings: [{"id": "svc", "from": "node", "defaults": {"tone": "accent2", "size": 14}}], or are changed for all at once by each: [{"drawingId": "node", "data": {"size": 16}}]. A link between two modules needs no id and, with the style tokens set, no data; it is then known as from-to (a second one between the same two gets -2, and the write's answer names it).
Compose for the landscape view: flow "right" for a long chain, "down" for a hierarchy that is wide and shallow. This is the shape of such a write:
<example>
${JSON.stringify(DIAGRAM_EXAMPLE)}
</example>
Each look measures what a picture hides, under figure.structure, with the ids and sizes involved: crossings (a line through a module; a straight or curved line is not routed, so give it route "elbow" or move what it crosses), labels (a link's words that a module covers or that lie over it, over: [...], or that another line is drawn through, crossedBy: [...]), struck (a line through a frame's name or a lane's header), overlaps, overflow, words (two runs of words inside one module lying over each other) relations (a line inside a tree or mind map that found no way round its nodes) and shared (two links whose lines lie one on the other for a stretch, so a reader cannot tell which goes where). Clear them by giving room (a larger gap in arrange, a module moved, the size in needs, labelAt to slide a link's words along it), in one write, and look again. A figure of a hundred or more parts opens too small to read whole, which is expected: judge its structure by these measures and by close-ups of its densest regions.
Keep api.mermaid for the rare notation none of this covers, since its generic look ignores the style. Structure drawings take one of the style's effects as their effect parameter, which gives them the style's texture.`,
  },
  maps: {
    when: "whenever anything is placed on the earth: a march or voyage, where events happened, where something lives or spreads, a trip through a region or a walk through a city (includes the geomap card)",
    cards: ["geomap"],
    text: `Real geography comes from data. Draw the ground as a geomap module: its coastlines, lakes and rivers are real and its places, routes and areas are given in longitude and latitude, so every position and distance is true, while outlines drawn by hand invent the coast and misplace everything on it. Coordinates of well-known places to a hundredth of a degree come from what you know.
This holds down to one city: in a view a couple of hundred kilometres across or less, geomap draws OpenStreetMap's real roads and water under the places, and closer in the streets and parks, so a trip through a region or a walk through a town goes on the map with bounds close around its stops.
Those roads and waterways carry their names as the place writes them, in its own language and script. When they are not in the user's language, give geomap names: {name as you see it drawn: the name in the user's language} for the ones the figure needs read, because a reader cannot follow a route along streets they cannot read.
Put what the concept needs on the map itself (one route per stage or force, coloured or sized by what differs between them; areas for territories; dates as notes), and keep pictures and explanations as modules around or over it.
A route runs directly from point to point and knows nothing of the land, so one given only by its ports cuts across peninsulas and islands. For a voyage, add [lon, lat] waypoints in open water around capes and through straits, and for a land journey follow the real valleys, passes or roads, because a reader takes the line as the way that was travelled. Check every leg against the coast when you look.
Today's borders and roads on a historical map are anachronisms, so leave borders off unless they help readers find the places, and then say they are modern; set roads: false to leave today's roads and railways off while keeping the fine coast and water under them.
A map's edge is where the ground was cut. When the map is the figure's ground and fills most of the view, keep the default edge: "frame", which says where the land stops. edge: "fade" hides the outer part of the map and leaves land dissolving into paper, which suits only a small map set among other pictures as a vignette.`,
  },
  exploration: {
    when: "before adding controls, animation, click behaviour, subscenes or detail pages",
    text: `Exploration is optional. Give a module a detail target only when there is substantial content the drawing cannot show, such as a mechanism, worked example or comparison; give it a scene target only when that part deserves its own figure. Most modules have no target, so leave it out, and a detail never restates a label. Detail content is separately opened HTML prose, never the main diagram. Empty subscenes can be created for later expansion.

A scene's script is its interaction field, a JavaScript function body receiving api:
- api.on(moduleId, event, callback) subscribes to module events; drawings send them with api.emit, and the slider and choice library drawings send "change".
- api.set(moduleId, dataPatch) changes instance data. api.move(moduleId, x, y) moves a module and the links on it.
- api.animate(seconds => ...) coordinates animation. api.cleanup(fn) disposes resources.
- api.openScene(id) and api.openDetail(id) navigate. A module target navigates without code.

These states are transient, since the saved work is what reopens, so the default state belongs in instance data. When a control changes values, keep the scales they are read against (axes, reference lines, maxima) fixed over the control's range, so a change shows as a change, with ticks on round numbers. Register async handlers as async functions so preview waits for them.
Give the scene checks [{moduleId, selector}] for the important buttons its script or a drawing answers: view_canvas then shows them pressed. Test a sequence with view_canvas actions in a specified scene, because an interaction you have not seen run is unverified. A module's target needs no check, as the app opens it without your code: view_canvas already shows every subscene, and a detail page is laid out by the app, so a click that opens one is reported in words, not pictured.`,
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

/** A draw_guide call's request, if it was one the tool could answer. */
function requested(call: Item) {
  try {
    return guideSchema.safeParse(JSON.parse(call.arguments)).data;
  } catch {
    return undefined;
  }
}
/** What the author has already read and still has above in this conversation: a summary
 * replaces the conversation, and takes these with it. A call refused gave it nothing.
 * `pending` are calls of the batch being run whose results are still to come: a guide asked
 * for beside set_brief is read, even though its answer follows the brief's. */
export function guidesRead(input: Item[], pending: Item[] = []) {
  const answered = new Set([
    ...input.filter((i) => i.type === "function_call_output").map((i) => i.call_id),
    ...pending.map((c) => c.call_id),
  ]);
  const read = { topics: new Set<string>(), drawings: new Set<string>() };
  for (const item of input) {
    if (item.type !== "function_call" || item.name !== "draw_guide" || !answered.has(item.call_id))
      continue;
    const asked = requested(item);
    for (const topic of asked?.topics ?? []) {
      read.topics.add(topic);
      guides[topic].cards?.forEach((id) => read.drawings.add(id));
    }
    for (const id of asked?.drawings ?? []) read.drawings.add(id);
  }
  // A write's result carries the cards of the drawings it was the first to use.
  for (const item of input) {
    if (item.type !== "function_call_output" || typeof item.output !== "string" || !item.output.includes('"cards"'))
      continue;
    try {
      for (const card of JSON.parse(item.output).cards ?? [])
        if (typeof card?.id === "string") read.drawings.add(card.id);
    } catch {
      // Not a write's result.
    }
  }
  return read;
}

/** The answer to draw_guide, as plain text: each guide under its topic, each card as one
 * line of JSON. What is already above is named, not repeated: it would only lengthen what
 * every later turn carries. */
export function readGuides(
  request: { topics?: GuideTopic[]; drawings?: string[] },
  kit: Material[],
  read: ReturnType<typeof guidesRead>,
) {
  const above: string[] = [];
  const topics = (request.topics ?? []).filter((t) => !read.topics.has(t) || !above.push(t));
  const wanted = [...new Set([...topics.flatMap((t) => guides[t].cards ?? []), ...(request.drawings ?? [])])];
  const drawings = wanted.filter((id) => !read.drawings.has(id) || !above.push(id));
  const known = new Map(
    kit.filter((m): m is DrawingMaterial => m.kind === "drawing").map((m) => [m.id, m]),
  );
  const cards = drawings.flatMap((id) => (known.has(id) ? [drawingCard(known.get(id)!)] : []));
  const unknown = drawings.filter((id) => !known.has(id));
  return [
    ...topics.map((topic) => `## ${topic}\n${guides[topic].text}`),
    ...(cards.length
      ? [["## Drawing cards", ...cards.map((card) => JSON.stringify(card))].join("\n")]
      : []),
    ...(above.length ? [`Already above in this conversation: ${above.join(", ")}.`] : []),
    ...(unknown.length
      ? [`Not library drawings: ${unknown.join(", ")}. The library's drawings are listed under # Library.`]
      : []),
  ].join("\n\n");
}
