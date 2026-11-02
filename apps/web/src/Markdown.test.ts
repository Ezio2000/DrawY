import { createElement } from "react";
import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, plain, tidy } from "./Markdown.tsx";

it("drops the citation markers some models leave and keeps citations on their words", () => {
  const text = "一句话。citeturn779909search2来源[OpenAI](https://openai.com/)";
  const start = text.indexOf("[");
  const { text: clean, citations } = tidy(text, [{ start, end: text.length, url: "https://openai.com/", title: "OpenAI" }]);
  expect(clean).toBe("一句话。来源[OpenAI](https://openai.com/)");
  expect(clean.slice(citations[0].start, citations[0].end)).toBe("[OpenAI](https://openai.com/)");
});

it("renders emphasis, lists and cited sources instead of showing the markup", () => {
  const text = "**一句话理解：**它是架构。\n\n- 连续\n- 并行\n\n见 ([openai.com](https://openai.com/))";
  const start = text.indexOf("[openai");
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text,
      citations: [{ start, end: text.indexOf(")", start) + 1, url: "https://openai.com/", title: "OpenAI" }],
    }),
  );
  expect(html).toContain("<strong>一句话理解：</strong>它是架构。");
  expect(html).toContain("<ul><li>连续</li><li>并行</li></ul>");
  expect(html).toMatch(/见<a class="[^"]*md-source[^"]*" href="https:\/\/openai.com\/" title="OpenAI"[^>]*>openai.com<\/a><\/p>/);
  expect(html).not.toContain("**");
});

it("reads markdown as one plain line", () => {
  expect(plain("**注意边界：**原型citex面向 `GitHub`\n- 一个仓库")).toBe("注意边界：原型面向 GitHub 一个仓库");
});
