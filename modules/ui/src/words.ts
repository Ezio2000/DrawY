import type { Locale } from "./locale.tsx";
import type { PresetId } from "./gesture.ts";

/* What the interface primitives say, in each language. */

const en = {
  close: "Close",
  undo: "Undo",
  gestures: "Gestures and controls",
  current: (name: string) => `Current: ${name}`,
  custom: "Custom",
  done: "Done",
  preset: "Preset",
  presets: {
    trackpad: [
      "Trackpad",
      "Two-finger swipe to pan, pinch to zoom; mouse wheel automatically switches to zoom",
    ],
    drag: [
      "Three-finger drag / mouse",
      "Drag to pan the canvas, drag away cards and panels; two-finger swipe, wheel, or pinch to zoom",
    ],
    scroll: [
      "Scroll to browse",
      "Two-finger swipe and wheel both pan; pinch or ⌘/Ctrl + wheel to zoom",
    ],
    steady: [
      "Steady",
      "Longer trigger distance, no flick gestures, no inertia, panels don't close on swipe",
    ],
  } as Record<PresetId, [string, string]>,
  canvas: "Canvas",
  scrolls: {
    auto: [
      "Automatic",
      "Two-finger trackpad swipe to pan, mouse wheel to zoom",
    ],
    pan: [
      "Pan",
      "Two-finger swipe and wheel both pan; pinch or ⌘/Ctrl + wheel to zoom",
    ],
    zoom: [
      "Zoom",
      "Two-finger swipe and wheel both zoom, drag to pan; horizontal swipe still pans",
    ],
  },
  swipeAndWheel: "Two-finger swipe and wheel",
  zoomDirection: "Scroll zoom direction",
  zoomDirectionIdle: "No setting needed when scrolling does not zoom",
  zoomDirectionNote: "Switch if the direction is reversed; pinch is unaffected",
  standard: "Standard",
  reversed: "Reversed",
  levels: "Zoom to switch levels",
  levelsNote:
    "Zoom in to enter a node, zoom out to return to the previous level; when off, only zooms the view",
  inertia: "Inertial scrolling",
  inertiaNote:
    "After releasing a drag, the canvas keeps gliding and gradually stops",
  reach: "Trigger distance",
  reachTitle: "How far a gesture must travel to take effect",
  reachNote: (enter: number, back: string, swipe: number, pull: number) =>
    `Zoom in to ${enter}× to enter, zoom out to ${back} to return; horizontal swipe up to ${swipe}px, pull down ${pull}px`,
  reaches: { short: "Short", standard: "Standard", long: "Long" },
  flick: "A quick swipe is enough",
  flickNote: "A fast flick, no need to cover the full distance",
  cards: "Cards and panels",
  cardSwipes: "Swipe to switch cards",
  cardSwipesNote:
    "Swipe right or pull down from the top of the page to go back, swipe left to open the next one",
  pointerDrag: "Drag cards and panels",
  pointerDragNote:
    "Drag with a mouse or three fingers; press and hold an empty spot on a card, the sidebar, or a panel and drag it away",
  sheetSwipes: "Swipe to close panels and pop-ups",
  sheetSwipesNote:
    "Swipe toward the edge to collapse the sidebar, panels, and bottom pop-ups",
};

export const words: Record<Locale, typeof en> = {
  en,
  zh: {
    close: "关闭",
    undo: "撤销",
    gestures: "手势与操作",
    current: (name) => `当前：${name}`,
    custom: "自定义",
    done: "完成",
    preset: "预设",
    presets: {
      trackpad: [
        "触控板",
        "双指滑动平移，双指捏合缩放；鼠标滚轮自动切换为缩放",
      ],
      drag: [
        "三指拖移 / 鼠标",
        "拖动平移画布，拖走卡片和面板；双指滑动、滚轮或捏合缩放",
      ],
      scroll: [
        "滚动浏览",
        "双指滑动和滚轮都用于平移；捏合或 ⌘/Ctrl + 滚轮缩放",
      ],
      steady: [
        "稳妥",
        "触发距离更长，不用快速轻扫，没有惯性，面板不会被滑动关闭",
      ],
    },
    canvas: "画布",
    scrolls: {
      auto: ["自动", "触控板双指滑动平移，鼠标滚轮缩放"],
      pan: ["平移", "双指滑动和滚轮都平移；捏合或 ⌘/Ctrl + 滚轮缩放"],
      zoom: ["缩放", "双指滑动和滚轮都缩放，拖动平移；横向滑动仍然平移"],
    },
    swipeAndWheel: "双指滑动与滚轮",
    zoomDirection: "滚动缩放方向",
    zoomDirectionIdle: "滚动不缩放时无需设置",
    zoomDirectionNote: "方向反了就切换；不影响捏合",
    standard: "标准",
    reversed: "反向",
    levels: "缩放切换层级",
    levelsNote: "放大进入节点，缩小返回上一层；关闭后只缩放视图",
    inertia: "惯性滚动",
    inertiaNote: "松开拖动后，画布继续滑行并逐渐停下",
    reach: "触发距离",
    reachTitle: "手势要移动多远才生效",
    reachNote: (enter, back, swipe, pull) =>
      `放大到 ${enter}× 进入，缩小到 ${back} 返回；横向轻扫最多 ${swipe}px，下拉 ${pull}px`,
    reaches: { short: "短", standard: "标准", long: "长" },
    flick: "快速轻扫即可",
    flickNote: "快速一扫，不必滑满整段距离",
    cards: "卡片与面板",
    cardSwipes: "滑动切换卡片",
    cardSwipesNote: "右滑或在页面顶部下拉返回，左滑打开下一张",
    pointerDrag: "拖动卡片和面板",
    pointerDragNote: "用鼠标或三指拖动；在卡片、侧栏或面板的空白处按住并拖走",
    sheetSwipes: "滑动关闭面板和弹窗",
    sheetSwipesNote: "朝边缘滑动，收起侧栏、面板和底部弹窗",
  },
};
