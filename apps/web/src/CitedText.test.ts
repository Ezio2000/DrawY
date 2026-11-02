import { createElement } from "react";
import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CitedText } from "./CitedText.tsx";

it("renders a clickable source inline without dropping the surrounding text", () => {
  const html = renderToStaticMarkup(createElement(CitedText, { text: "说明[1]结束", citations: [{ start: 2, end: 5, url: "https://openai.com/", title: "OpenAI" }] }));
  expect(html).toContain('说明<a href="https://openai.com/"');
  expect(html).toContain('>OpenAI</a>结束');
});
