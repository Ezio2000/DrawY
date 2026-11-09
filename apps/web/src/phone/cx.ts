import { classes, vocabulary } from "@drawy/ui";
import sheet from "./phone.module.css";

/** Class names for the phone page: its own sheet and the app's shared vocabulary (buttons,
 * fields), never the desktop page's sheet, whose names would bring its layout along. */
export const cx = classes(sheet, vocabulary);
