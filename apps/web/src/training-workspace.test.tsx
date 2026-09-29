import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnnualTrainingPlan } from "../../../packages/shared/src/training-analytics";
import { filterAnnualPlans, TrainingAnalyticsPanel } from "./training-analytics";
import { TrainingWorkspace } from "./training-workspace";

const plans: AnnualTrainingPlan[] = [
  {
    id: "a",
    title: "跨月培训",
    status: "published",
    startAt: "2026-01-31T16:00:00Z",
    dueAt: "2026-02-01T01:00:00Z",
    plannedHours: 2,
    participantCount: 2,
  },
  {
    id: "b",
    title: "一月草稿",
    status: "draft",
    startAt: "2026-01-31T15:59:00Z",
    dueAt: "2026-02-01T01:00:00Z",
    plannedHours: null,
    participantCount: 3,
  },
];
test("annual plan filters combine Beijing start month and status", () => {
  expect(filterAnnualPlans(plans, "2", "published").map((p) => p.id)).toEqual(["a"]);
  expect(filterAnnualPlans(plans, "1", "published")).toEqual([]);
  expect(filterAnnualPlans(plans, "", "draft").map((p) => p.id)).toEqual(["b"]);
  expect(filterAnnualPlans(plans, "", "")).toEqual(plans);
});
test("training workspace opens annual summary and exposes exactly four module choices", () => {
  const html = renderToStaticMarkup(
    <TrainingWorkspace
      session={{ role: "department_manager", accountId: "a", employeeId: "e", departmentId: "d" }}
    />,
  );
  expect(html).toContain("部门年度培训计划汇总表");
  expect(html).toContain("年度培训计划汇总表</h2>");
  expect(html).toContain("计划管理");
  expect(html).toContain("培训任务");
  expect(html).toContain("培训资料");
  expect(html).not.toContain("新建培训计划");
  expect(html).toContain('aria-label="年度培训计划区域"');
});
test("factory read changes annual read scope without changing manager role", () => {
  const html = renderToStaticMarkup(
    <TrainingWorkspace
      session={{
        role: "department_manager",
        accountId: "a",
        employeeId: "e",
        departmentId: "d",
        factoryRead: true,
      }}
    />,
  );
  expect(html).toContain("全厂年度培训计划汇总表");
  expect(html).toContain('aria-label="培训统计部门"');
});
test("overview statistics omit plan-only filtering", () => {
  const html = renderToStaticMarkup(<TrainingAnalyticsPanel showPlanDetails={false} />);
  expect(html).toContain("年度培训计划与时数统计");
  expect(html).not.toContain('aria-label="年度培训计划区域"');
  expect(html).not.toContain('aria-label="年度培训计划月份"');
});
