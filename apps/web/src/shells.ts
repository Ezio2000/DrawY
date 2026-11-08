import { lazy, memo, useEffect, useState, type ComponentType } from "react";
import type { Locale } from "@drawy/ui";
import type { ShellProps } from "./shell.ts";
import type { KeyValue } from "./storage.ts";

/** A work page for one kind of device, loaded when it is first needed: `fits` is the media
 * query (width and pointer, never the browser's name) of the devices it is for; the page
 * whose query matches first is used, and the one without a query when none does. */
function shell(
  load: () => Promise<{ default: ComponentType<ShellProps> }>,
  fits: string | null,
  name: Record<Locale, string>,
  /** Whether the page takes the whole screen, without the app's side bar. */
  whole = false,
) {
  // A page is drawn again only when its props change, and they keep their identity: what
  // changes inside them is read slice by slice where it is shown.
  return { page: lazy(() => load().then((m) => ({ default: memo(m.default) }))), fits, name, whole };
}

/** Phones, held either way: a window narrower than 600px, or a touch screen less than
 * 500px tall (a phone on its side). A tablet's shorter side is 600px or more, which leaves
 * room for the canvas and a panel beside it, and a tablet is where people still lay a
 * picture out with a finger or a pen; so tablets, touch laptops and every computer get the
 * desktop page, whose canvas takes fingers as well as a mouse. */
const PHONE = "(max-width: 599px), (pointer: coarse) and (max-height: 499px)";

/** The work pages there are. A page for another device is one file and one line here,
 * above the desktop page, which takes whatever no other page fits. */
export const shells = {
  phone: shell(() => import("./phone/WorkPage.tsx"), PHONE, { zh: "手机", en: "Phone" }, true),
  desktop: shell(() => import("./desktop/WorkPage.tsx"), null, { zh: "电脑", en: "Desktop" }),
};
export type Device = keyof typeof shells;
/** Which page to use: one the person picked, or "auto" to go by the device. */
export type ShellChoice = Device | "auto";
const devices = Object.keys(shells) as Device[];
const KEY = "drawy.shell";

/** The page a device fits, of `pages` (name and query, in the order registered): the first
 * whose query matches, else the one without a query. */
export function fitting<D extends string>(
  pages: (readonly [D, string | null])[],
  matches: (query: string) => boolean,
): D {
  return (
    pages.find(([, q]) => q !== null && matches(q))?.[0] ??
    pages.find(([, q]) => q === null)?.[0] ??
    pages[0][0]
  );
}
const registered = devices.map((d) => [d, shells[d].fits] as const);

/** The work page to show, which follows the device as the window changes unless the
 * person picked one; their pick is kept in `storage`. */
export function useShell(storage: KeyValue) {
  const read = (): ShellChoice => {
    const kept = storage.get(KEY);
    return kept && kept in shells ? (kept as Device) : "auto";
  };
  const [choice, setChoice] = useState(read);
  const media = (q: string) => matchMedia(q).matches;
  const [fits, setFits] = useState(() => fitting(registered, media));
  useEffect(() => {
    const queries = devices.flatMap((d) => shells[d].fits ?? []).map((q) => matchMedia(q));
    const changed = () => setFits(fitting(registered, media));
    for (const q of queries) q.addEventListener("change", changed);
    return () => {
      for (const q of queries) q.removeEventListener("change", changed);
    };
  }, []);
  const device = choice === "auto" ? fits : choice;
  return {
    device,
    choice,
    /** What "auto" comes to on this device. */
    fits,
    /** The pages to pick from, when there is more than one. */
    devices,
    nameOf: (d: Device, locale: Locale) => shells[d].name[locale],
    choose(next: ShellChoice) {
      storage.set(KEY, next);
      setChoice(next);
    },
    Page: shells[device].page,
    /** Whether the page takes the whole screen, without the app's side bar. */
    whole: shells[device].whole,
  };
}
export type Shells = ReturnType<typeof useShell>;
