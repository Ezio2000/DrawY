import { z } from "zod";
export const diagramSchema = z.object({
  id: z.string().min(1),
  format: z.enum(["mermaid", "plantuml"]),
  source: z.string(),
});
export const pageSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  parentId: z.string().nullable(),
  html: z.string(),
  diagrams: z.array(diagramSchema),
  assetIds: z.array(z.string()),
  checkSelectors: z.array(z.string()).default([]),
});
export type Page = z.infer<typeof pageSchema>;
export interface Work {
  id: string;
  title: string;
  rootId: string;
  pages: Record<string, Page>;
  revision: number;
  updatedAt: number;
}
export interface Asset {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  source: "upload" | "generated" | "review";
  url: string;
  generationId?: string;
}
export interface Role {
  channel: "api" | "oauth";
  baseUrl: string;
  credential: string;
  accountId?: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh";
  fast: boolean;
}
export interface Settings {
  author: Role;
  reviewer: Role;
  image: {
    channel: "api" | "oauth";
    baseUrl: string;
    credential: string;
    accountId?: string;
    model: string;
  };
  preferences: string;
}
export const defaultSettings = (): Settings => ({
  author: {
    channel: "api",
    baseUrl: "https://api.openai.com/v1",
    credential: "",
    model: "gpt-6-astra",
    effort: "medium",
    fast: false,
  },
  reviewer: {
    channel: "api",
    baseUrl: "https://api.openai.com/v1",
    credential: "",
    model: "gpt-6-astra",
    effort: "medium",
    fast: false,
  },
  image: {
    channel: "api",
    baseUrl: "https://api.openai.com/v1",
    credential: "",
    model: "gpt-image-2.5-sunburst",
  },
  preferences: "",
});
export const roleSchema = z.object({
  channel: z.enum(["api", "oauth"]),
  baseUrl: z.url(),
  credential: z.string(),
  accountId: z.string().optional(),
  model: z.string().min(1),
  effort: z.enum(["low", "medium", "high", "xhigh"]),
  fast: z.boolean(),
});
export const settingsSchema = z.object({
  author: roleSchema,
  reviewer: roleSchema,
  image: roleSchema.omit({ effort: true, fast: true }),
  preferences: z.string(),
});
export interface Issue {
  pageId: string;
  area: string;
  severity: "blocking" | "minor";
  detail: string;
}
export interface ReviewResult {
  revision: number;
  status: "passed" | "issues" | "failed";
  issues: Issue[];
  screenshots: Asset[];
  error?: string;
}
export interface Message {
  role: "user" | "assistant";
  text: string;
  assets?: string[];
}
export interface Run {
  id: string;
  workId: string;
  pageId: string;
  status:
    "running" | "waiting" | "reviewing" | "completed" | "failed" | "cancelled";
  messages: Message[];
  question?: { text: string; options: string[] };
  review?: ReviewResult;
  error?: string;
  startedAt: number;
  elapsedMs?: number;
  firstOutputMs?: number;
  firstPageMs?: number;
}
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const id = () => crypto.randomUUID();
