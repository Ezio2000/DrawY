import type { DrawingMaterial, Material } from "@drawy/materials/schema";
import { drawingCard } from "../materials/index.ts";
import type { GuideTopic } from "../contracts/index.ts";
import type { Item } from "../models/index.ts";
import { guideSchema } from "./tools.ts";

/** The author's instructions for situations only some works meet, read with draw_guide
 * when `when` applies. The system prompt lists each topic's `when` and nothing else, so
 * what a work does not need costs it nothing. `cards` come along with the topic, because
 * its rules are about using those drawings. */
export const guides: Record<GuideTopic, { when: string; cards?: string[]; text: string }> = {
  pictures: {
    when: "before your first generate_images call, and before composing several pictured subjects into one scene",
    text: `Asking for pictures. Generation runs in the background, so as soon as you know what is missing, request all of it in one call, before working out the layout, and compose with the returned ids while they develop.
Write depicts for a picture model that knows nothing about the work: the subject, its state, the view (side, from above, cut away), pose, gaze and what it holds or touches, and the materials and details that identify it. For a person or animal say how much of the body shows ("full body, feet included"), since the model crops otherwise. Leave style out of depicts, because the style and the brief's direction are added to every picture and a second description of the look fights them.
A picture carries no words: the prompt forbids text in the image, so names and numbers belong in your labels.
Choose the role by how the picture will be used. object, figure and icon are cut-outs on transparency that you can place, move and label; scene is a vignette whose edges fade into paper; texture is a seamless surface. Choose the aspect that fits the thing, and size its module to that aspect.
For one character across several pictures, give the first a key and put that key in the others' references, because a description alone drifts between pictures. A picture with a reference in the same request starts only when that one has developed, so its ids are still usable at once but it takes twice as long; the others run side by side. Use references only for what a picture must be made from: the work's existing pictures in the style are already shown to the model as style references.
A generated picture that came out wrong (wrong subject, text in it, clashing style) is replaced with a corrected one, since a label cannot rescue it.

Composing pictures. Keep every picture an independent module and compose it with your own paths, labels, connections and interaction: a picture supplies a thing's appearance, and the scene's layout stays yours, so the user can move or swap each part. Do not let one generated painting hold the whole idea: paint the world as a backdrop and each subject that matters as its own picture, so the scene can point at, explain or change it. Do not add decorative pictures to purely abstract figures, or a small picture to each row of a structured one, where they add nothing the figure states.
view_canvas reports where each picture's visible content actually is, in scene units. Place labels, leaders and neighbours by that, since a picture rarely fills its module's box.
When an edit changes how a thing looks, update every other depiction of that thing so the work stays consistent.`,
  },
  drawing: {
    when: "before writing a drawing or link drawing of your own, including one that composes library drawings with api.draw",
    text: `A drawing definition is reusable JavaScript function-body source. It receives api and returns an Element (or awaits one), because the runtime places what is returned and reports anything else as an error. Leave out HTML documents, body or head, app chrome and viewport sizing. Use the local module width and height; all positions outside a drawing are scene units. Drawing code is async, so await initial data before returning. Keep the source readable, and reuse one definition across instances with different data.

Drawing API:
- api.data: instance parameters. api.width, api.height: module size. api.theme: the work's style tokens (ink, muted, accent, accent2, paper, stroke, font).
- api.svg('<svg viewBox="0 0 ...">...</svg>') returns an SVG element. api.html('<style>...</style><div>...</div>') returns local DOM. Normal DOM methods and event handlers work.
- api.material(id, {width, height, fit, align, color}) returns a picture material fitted by its visible content into the module or the given box, standing on the box's bottom edge unless align is "center" or "top"; color inks a recolourable icon.
- api.materials[id] gives {url, width, height, anchors} of each picture in the work, for compositions such as <image href> inside your own SVG; anchors are named points normalized to the visible content.
- await api.draw(id, data, {width, height}) returns a library drawing's element, sized to the module unless a size is given. Read its card first.
- api.effect(id) returns "url(#…)" for a filter, fill or marker attribute. await api.mermaid(source) returns a rendered diagram.
- api.emit(event, value) sends an event to the scene interaction. api.animate(seconds => ...) starts a frame loop. api.cleanup(fn) registers cleanup.
- Link drawings also receive api.from and api.to in local coordinates, and api.fromSide and api.toSide, the edge of its module each anchor sits on (left, right, top, bottom, or null inside), so a link can leave and arrive square to it.

Editable by hand. People who do not code edit works by hand, and they can change only what the work exposes. Declare in the drawing's params each instance data key a person may want to change, with a short label in the user's language and a type (text; number, with min, max and step for a slider; boolean; color; picture, holding a picture material id; choice, with its options); the app shows these as plain controls. Keep the words shown, colours, sizes and pictures in instance data read through params rather than written into the source: words in the source can be retyped only where they occur once, and words or colours the code computes cannot be changed by hand at all. Give an svg that holds words style="overflow:visible", as the library drawings do, so words a person lengthens run past the module's edge instead of being cut off.

Materials are taken into the work when a drawing or interaction names them literally (api.material("apple"), api.draw("arrow"), api.effect("pencil-grain")), a module or link uses one as its drawingId, or a module's data holds their id as a string. List any others in write_work.materials, because an id built at runtime cannot be found by reading the source.

Looks. Use the style's tokens for ink, colours, stroke and font, and its effects for texture, so drawn and pictured parts read as one work. Mark custom pointer controls with data-interactive so the canvas leaves their gestures alone.`,
  },
  diagrams: {
    when: "when the figure is or contains a flowchart, system diagram, hierarchy, matrix, table, chart or other conventional structured form",
    text: `Build a conventional form from the library's drawing for it: hierarchy, layered architecture (layers), two-by-two matrix (quadrant), comparison table (compare), pyramid or funnel (pyramid), set overlap (venn), mind map (mindmap), numbered process (steps), swimlanes, cause and effect (fishbone), message sequence (sequence), nested rings (concentric), schedule (gantt), a few quantities (bars), parts of a whole (donut), a reading on a scale (gauge), a headline number (stat), several qualities compared (radar), a checklist (checklist), a speech bubble (callout). They already have balanced spacing, a type scale and the style's colours, which boxes placed by hand rarely reach. Read each one's card. They can also be one part of a larger idea, such as a gauge on a drawn machine or a sequence beside the two machines it connects.
Use one of these as the whole figure only when the user names it or the subject has exactly that structure, since it is the picture every other author would draw.
Draw a flowchart or system diagram as one node module per block, joined by arrow links with route elbow (first set to the axis the source anchor faces), with blocks of one kind the same size and aligned on shared rows and columns, so the user can move a block and its connections follow. A node's outline is notation the reader expects, so it is the one box the visual language allows.
Keep api.mermaid for UML class or state diagrams the library does not provide, since its generic look ignores the style. Structure drawings take one of the style's effects as their effect parameter, which gives them the style's texture.`,
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
    text: `Exploration is optional. Give a module a detail target only when there is substantial content the drawing cannot show, such as a mechanism, worked example or comparison; give it a scene target only when that part deserves its own figure. Most modules have target null, and a detail never restates a label. Detail content is separately opened HTML prose, never the main diagram. Empty subscenes can be created for later expansion.

Scene interactions are JavaScript function bodies receiving api:
- api.on(moduleId, event, callback) subscribes to module events; drawings send them with api.emit, and the slider and choice library drawings send "change".
- api.set(moduleId, dataPatch) changes instance data. api.move(moduleId, x, y) moves a module and its connected anchors.
- api.animate(seconds => ...) coordinates animation. api.cleanup(fn) disposes resources.
- api.openScene(id) and api.openDetail(id) navigate. A module target navigates without code.

These states are transient, since the saved work is what reopens, so the default state belongs in instance data. When a control changes values, keep the scales they are read against (axes, reference lines, maxima) fixed over the control's range, so a change shows as a change, with ticks on round numbers. Register async handlers as async functions so preview waits for them.
Give the scene's record checks [{moduleId, selector}] for important buttons: view_canvas then shows them pressed. Test a sequence with view_canvas actions in a specified scene, because an interaction you have not seen run is unverified.`,
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
 * replaces the conversation, and takes these with it. A call refused gave it nothing. */
export function guidesRead(input: Item[]) {
  const answered = new Set(
    input.filter((i) => i.type === "function_call_output").map((i) => i.call_id),
  );
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
  return read;
}

/** The answer to draw_guide. What is already above is named, not repeated: it would only
 * lengthen what every later turn carries. */
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
  const unknown = drawings.filter((id) => !known.has(id));
  return {
    ...(topics.length ? { guides: topics.map((topic) => ({ topic, text: guides[topic].text })) } : {}),
    ...(drawings.some((id) => known.has(id))
      ? { drawings: drawings.flatMap((id) => (known.has(id) ? [drawingCard(known.get(id)!)] : [])) }
      : {}),
    ...(above.length ? { alreadyAbove: above } : {}),
    ...(unknown.length
      ? { unknown, note: "These are not library drawings. Their ids are listed under # Library; search others with find_materials." }
      : {}),
  };
}
