// What every surface of SeeY builds on, below any domain: direct manipulation — gestures,
// springs and how far a reader swipes — motion conventions, and the interface primitives:
// sheets, menus, switches, segmented controls, tooltips and toasts.
export { classes } from "./classes.ts";
export { vocabulary } from "./cx.ts";
export { reducedMotion } from "./motion.ts";
export { ownsScroll } from "./scroll.ts";
export * from "./gesture.ts";
export {
  Menu,
  Presence,
  Segmented,
  Spinner,
  Switch,
  Tooltips,
  UndoToast,
  sendsOnEnter,
  useClosing,
} from "./primitives.tsx";
export { Dialog, GestureDialog } from "./dialogs.tsx";
export {
  browserLocale,
  langOf,
  LocaleContext,
  localeOf,
  pageLocale,
  useLocale,
  useWords,
  type Locale,
} from "./locale.tsx";
