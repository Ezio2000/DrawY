import { pageLocale } from "@drawy/ui";
import type {
  Account,
  ModelChoice,
  ServiceChoice,
} from "../../../modules/contracts/index.ts";
export async function api<T = any>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "X-Drawy-Locale": pageLocale(),
      ...(data instanceof FormData ? {} : { "Content-Type": "application/json" }),
    },
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
  });
  if (!r.ok) {
    const err = await r.json();
    throw Error(err.error);
  }
  return r.json();
}
/** A work as lists show it. */
export interface Summary {
  id: string;
  title: string;
  revision: number;
  updatedAt: number;
  /** The latest overview the author took of it. */
  cover: string | null;
}
export type User = Account;
/** What the user can draw, search and paint with, and what they picked of each. */
export interface Models {
  models: ModelChoice[];
  default: string;
  chosen: string;
  images: ServiceChoice[];
  image: string;
  searches: ServiceChoice[];
  /** The search service a model searching with one uses. */
  search: string | null;
}
