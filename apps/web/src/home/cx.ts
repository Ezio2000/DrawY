import { classes, vocabulary } from "../ui/classes.ts";
import app from "../app.module.css";
import sheet from "./landing.module.css";

/** Class names for the home page: its own sheet first, then the app's (for the composer and
 * the canvas marks it shares with the work page) and the shared vocabulary. Its own names
 * are prefixed `l-` so they never meet one of the app's. */
export const cx = classes(sheet, app, vocabulary);
