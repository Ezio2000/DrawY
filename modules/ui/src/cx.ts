/// <reference path="./sheets.d.ts" />
import { classes } from "./classes.ts";
import sheet from "./ui.module.css";

/** The interface vocabulary other packages resolve their class names against: buttons,
 * fields, dialogs, menus, toasts and the stage bar. */
export const vocabulary: Readonly<Record<string, string>> = sheet;
export const cx = classes(sheet);
