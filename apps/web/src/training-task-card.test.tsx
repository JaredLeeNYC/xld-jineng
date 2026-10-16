import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TrainingTaskView } from "@jineng/skill-matrix-shared";
import { TrainingTaskCard } from "./app";
import { TrainingHoursForm, mayBackfillHours } from "./training-management";
const task: TrainingTaskView = {
  id: "task-1",
  planId: "plan-1",
  planTitle: "装配实操培训",
  trainingType: "general",
  departmentId: "dept-1",
  departmentName: "装配部",
  positionId: "pos-1",
  positionName: "装配工",
  employeeId: "employee-1",
  employeeName: "李华",
  employeeNumber: "E001",
  materialId: "material-1",
  materialTitle: "安全作业资料",
  ownerEmployeeId: "owner-1",
  ownerName: "张主管",
  startAt: "2026-09-08T01:00:00.000Z",
  dueAt: "2026-09-08T04:30:00.000Z",
  location: "一号车间",
  status: "returned",
  overdue: true,
  returnReason: "请补充签到记录",
  evidenceCount: 0,
  evidence: [],
};
describe("mobile training task card", () => {
  test("hours backfill requires a confirmed task and HR or its own-department designated manager", () => {
    const confirmed = { ...task, status: "confirmed" as const };
    const manager = {
      role: "department_manager",
      accountId: "a",
      employeeId: "owner-1",
      departmentId: "dept-1",
    };
    expect(mayBackfillHours(manager, confirmed)).toBe(true);
    expect(mayBackfillHours({ ...manager, departmentId: "other" }, confirmed)).toBe(false);
    expect(mayBackfillHours({ ...manager, employeeId: "other" }, confirmed)).toBe(false);
    expect(mayBackfillHours({ ...manager, role: "employee" }, confirmed)).toBe(false);
    expect(mayBackfillHours({ ...manager, role: "hr_admin", employeeId: "other" }, confirmed)).toBe(
      true,
    );
    expect(mayBackfillHours(manager, task)).toBe(false);
    expect(
      renderToStaticMarkup(<TrainingHoursForm label="李华实际时数" onSave={async () => {}} />),
    ).toContain("登记实际时数");
    expect(
      renderToStaticMarkup(
        <TrainingHoursForm label="历史计划授课小时" planned onSave={async () => {}} />,
      ),
    ).toContain("补录 / 修改授课小时");
  });
  test("shows department, position, training type and both China-local business times", () => {
    const html = renderToStaticMarkup(
      <TrainingTaskCard task={task} canManage>
        <button type="button">查看证据</button>
      </TrainingTaskCard>,
    );
    for (const value of [
      "装配部",
      "装配工",
      "内部培训",
      "张主管",
      "E001",
      "李华",
      "开始时间（中国时区）",
      "截止时间（中国时区）",
      "09:00:00",
      "12:30:00",
      "已逾期",
      "请补充签到记录",
      "查看证据",
    ])
      expect(html).toContain(value);
    expect(html).not.toContain("01:00:00");
  });
  test("employee cards preserve material information and handle an unassigned position", () => {
    const { positionName: _positionName, ...unassignedTask } = task;
    const html = renderToStaticMarkup(<TrainingTaskCard task={unassignedTask} canManage={false} />);
    expect(html).toContain("安全作业资料");
    expect(html).toContain("装配部");
    expect(html).toContain("岗位：未分配");
  });
});
