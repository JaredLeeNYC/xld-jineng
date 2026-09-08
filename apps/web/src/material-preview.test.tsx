import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MaterialPreviewButton } from "./material-preview";

describe("material preview boundaries", () => {
  test("renders a button without exposing a content URL before opening", () => {
    const html = renderToStaticMarkup(
      <MaterialPreviewButton url="/api/assessments/private-id/evidence" />,
    );
    expect(html).toContain("在线预览");
    expect(html).not.toContain("private-id");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("download=");
  });

  test("escapes untrusted labels as text", () => {
    const html = renderToStaticMarkup(
      <MaterialPreviewButton
        url="/api/material/content"
        label={'<img src=x onerror="alert(1)">'}
      />,
    );
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
});
