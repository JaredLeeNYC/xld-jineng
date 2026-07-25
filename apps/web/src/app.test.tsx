import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./app";

describe("application shell", () => {
  test("exposes the phase-one factory management areas", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("技能矩阵");
    expect(html).toContain("工作台");
    expect(html).toContain("员工档案");
    expect(html).toContain("技能标准");
    expect(html).toContain("评定管理");
    expect(html).toContain("培训任务");
    expect(html).toContain("张明");
  });
});
