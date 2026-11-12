import { lazy, memo, useEffect, useState, type ComponentType } from "react";
import type { Locale } from "@drawy/ui";
import type { ShellProps } from "./shell.ts";
import { store, stored } from "./storage.ts";

/** A work page for one kind of device, loaded when it is first needed. A page is drawn
 * again only when its props change, and they keep their identity: what changes inside them
 * is read slice by slice where it is shown. */
const page = (load: () => Promise<{ default: ComponentType<ShellProps> }>) =>
  lazy(() => load().then((m) => ({ default: memo(m.default) })));

/** Phones, held either way: a window narrower than 600px, or a touch screen less than
 * 500px tall (a phone on its side). A tablet's shorter side is 600px or more, which leaves
 * room for the canvas and a panel beside it, and a tablet is where people still lay a
 * picture out with a finger or a pen; so tablets, touch laptops and every computer get the
 * desktop page, whose canvas takes fingers as well as a mouse. */
const PHONE = "(max-width: 599px), (pointer: coarse) and (max-height: 499px)";

const shells = {
  /** The phone page takes the whole screen, without the app's side bar. */
  phone: { Page: page(() => import("./phone/WorkPage.tsx")), name: { zh: "手机", en: "Phone" }, whole: true },
  desktop: { Page: page(() => import("./desktop/WorkPage.tsx")), name: { zh: "电脑", en: "Desktop" }, whole: false },
};
type Device = keyof typeof shells;
/** Which page to use: one the person picked, or "auto" to go by the device. */
export type ShellChoice = Device | "auto";
const KEY = "drawy.shell";
const fitting = (): Device => (matchMedia(PHONE).matches ? "phone" : "desktop");

/** The work page to show, which follows the device as the window changes unless the
 * person picked one; their pick is kept in this browser. */
export function useShell() {
  const [choice, setChoice] = useState((): ShellChoice => {
    const kept = stored(KEY);
    return kept === "phone" || kept === "desktop" ? kept : "auto";
  });
  const [fits, setFits] = useState(fitting);
  useEffect(() => {
    const query = matchMedia(PHONE);
    const changed = () => setFits(fitting());
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  const device = choice === "auto" ? fits : choice;
  return {
    choice,
    /** What "auto" comes to on this device. */
    fits,
    nameOf: (d: Device, locale: Locale) => shells[d].name[locale],
    choose(next: ShellChoice) {
      store(KEY, next);
      setChoice(next);
    },
    Page: shells[device].Page,
    whole: shells[device].whole,
  };
}
export type Shells = ReturnType<typeof useShell>;
