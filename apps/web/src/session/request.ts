import { useState } from "react";
import type { Locale } from "@drawy/ui";
import type { Material, StyleMaterial } from "@drawy/materials/schema";
import { api } from "../api.ts";
import { SessionError } from "./types.ts";
import { Store } from "./store.ts";

/** Something sent along with the message: a picture, or any library material, with its
 * name in each language for whoever shows it to pick from. */
export interface Attachment {
  id: string;
  kind: string;
  name: Record<Locale, string>;
  url?: string;
}
/** How a library material rides along with a message. */
export const attachmentOf = (m: Material): Attachment => ({
  id: m.id,
  kind: m.kind,
  name: m.name,
  url:
    m.kind === "picture"
      ? m.file.url
      : m.kind === "style" && m.samples[0]
        ? `/materials/thumbs/${m.samples[0]}?size=96`
        : undefined,
});

/** The request being written: it outlives the page it is written on (a material picked
 * in the library, a request started on the home page that opens its new work), so it
 * belongs to the app rather than to one work. */
export interface RequestState {
  text: string;
  attachments: Attachment[];
  /** Pictures still uploading, shown as placeholders among the attachments. */
  uploading: number;
  /** The style a new work is to be drawn in, picked on the home page. */
  style?: StyleMaterial;
  /** Options picked on the author's questions, sent with whatever the user writes. */
  choices: string;
  /** Why the request holds a change written up for the author, until it is sent. */
  handed: string;
  /** Counts the times the request was handed something to send, for the field to take
   * the focus each time. */
  asked: number;
}

export class RequestDraft extends Store<RequestState> {
  private state: RequestState = { text: "", attachments: [], uploading: 0, choices: "", handed: "", asked: 0 };
  protected build() {
    return this.state;
  }
  private set(patch: Partial<RequestState>) {
    this.state = { ...this.state, ...patch };
    this.changed();
  }
  write = (text: string) => this.set({ text });
  choose = (choices: string) => this.set({ choices });
  setStyle = (style?: StyleMaterial) => this.set({ style });
  /** Adds a library material to the request, or picks it as the style. */
  use = (m: Material) => {
    if (m.kind === "style") return this.set({ style: m });
    if (this.state.attachments.some((a) => a.id === m.id)) return;
    this.set({ attachments: [...this.state.attachments, attachmentOf(m)] });
  };
  detach = (id: string) =>
    this.set({ attachments: this.state.attachments.filter((a) => a.id !== id) });
  /** Hands a change to the author: written into the request for the person to send, with
   * why it is there. */
  hand = (text?: string, why = "") =>
    this.set({ ...(text ? { text } : {}), handed: why, asked: this.state.asked + 1 });
  /** Uploads pictures and attaches each as it arrives. */
  upload = async (files: FileList | File[]) => {
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!images.length) throw new SessionError("imagesOnly");
    this.set({ uploading: this.state.uploading + images.length });
    let left = images.length;
    try {
      for (const file of images) {
        const data = new FormData();
        data.append("file", file);
        const m = await api<Material>("/materials", "POST", data);
        left--;
        this.set({
          attachments: [...this.state.attachments, attachmentOf(m)],
          uploading: this.state.uploading - 1,
        });
      }
    } finally {
      if (left) this.set({ uploading: this.state.uploading - left });
    }
  };
  /** Empties the request once it has been sent. */
  clear = () =>
    this.set({ text: "", attachments: [], style: undefined, choices: "", handed: "" });
}

/** The request being written, kept for the life of the page. Reading it is left to the
 * parts of the page that show it (`useSelect`), so writing a word does not draw the rest
 * of the page again. */
export function useRequest() {
  const [request] = useState(() => new RequestDraft());
  return request;
}
