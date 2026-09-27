import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { navigationForRole, type SkillMatrixCell } from "@jineng/skill-matrix-shared";
import { SkillMatrixPanel } from "./app";

test("HR can open the skill matrix directly from navigation", () => {
  expect(navigationForRole("hr_admin").find((item) => item.id === "matrix")).toEqual({
    id: "matrix",
    label: "技能矩阵",
    access: "read",
  });
});

test("matrix legend illustrates each L0–L4 level using four blocks", () => {
  const row: SkillMatrixCell = {
    employeeId: "e1",
    employeeNumber: "E1",
    employeeName: "员工甲",
    departmentId: "d1",
    departmentName: "生产部",
    positionId: "p1",
    positionName: "SMT操作员",
    skillId: "s1",
    skillCode: "S1",
    skillName: "焊接",
    requiredLevel: 2,
    required: true,
    currentLevel: 1,
    status: "gap",
    gap: 1,
  };
  const html = renderToStaticMarkup(<SkillMatrixPanel personal={false} initialRows={[row]} />);
  const legend = html.slice(html.indexOf('aria-label="能力等级说明"'));
  const articles = [...legend.matchAll(/<article[^>]*>(.*?)<\/article>/g)];
  expect(articles).toHaveLength(5);
  for (const [level, article] of articles.entries()) {
    expect(article[1]).toContain('class="matrix-level-blocks"');
    expect([...article[1]!.matchAll(/class="filled"/g)]).toHaveLength(level);
  }
});
