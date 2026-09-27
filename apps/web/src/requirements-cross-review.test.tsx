import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { navigationForRole, type SkillMatrixCell } from "@jineng/skill-matrix-shared";
import { SkillMatrixPanel, App } from "./app";

const row: SkillMatrixCell = {
  employeeId: "e",
  employeeNumber: "1",
  employeeName: "员工",
  departmentId: "d",
  departmentName: "生产部",
  positionId: "p",
  positionName: "操作员",
  skillId: "s",
  skillCode: "S",
  skillName: "技能",
  requiredLevel: 2,
  required: true,
  currentLevel: 1,
  status: "gap",
  gap: 1,
  areaId: "a",
  areaName: "SMT区",
};
test("independent acceptance: HR has matrix navigation and factory read introduces no new role", () => {
  expect(navigationForRole("hr_admin").find((n) => n.id === "matrix")).toEqual({
    id: "matrix",
    label: "技能矩阵",
    access: "read",
  });
  const html = renderToStaticMarkup(
    <App
      initialSession={{
        accountId: "a",
        employeeId: "e",
        employeeNumber: "HR001",
        displayName: "人事",
        role: "hr_admin",
        mustChangePassword: false,
      }}
    />,
  );
  expect(html).toContain("技能矩阵");
});
test("independent acceptance: legend has exactly four blocks and 0-4 filled with area option", () => {
  const html = renderToStaticMarkup(<SkillMatrixPanel personal={false} initialRows={[row]} />);
  const legend = html.slice(html.indexOf('class="matrix-level-legend"'));
  const articles = [...legend.matchAll(/<article>(.*?)<\/article>/g)].slice(0, 5);
  expect(articles).toHaveLength(5);
  articles.forEach((article, index) => {
    expect(article[1]).toContain(`L${index}`);
    expect([...article[1]!.matchAll(/class="filled"/g)]).toHaveLength(index);
    const blocks = article[1]!.slice(article[1]!.indexOf('class="matrix-level-blocks"'));
    expect([...blocks.matchAll(/<span/g)]).toHaveLength(4);
  });
  expect(html).toContain('aria-label="区域筛选"');
  expect(html).toContain("生产部 · SMT区");
});
