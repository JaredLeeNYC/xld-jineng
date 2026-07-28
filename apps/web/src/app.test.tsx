import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  App,
  AuditPanel,
  AssessmentPanel,
  OrganizationPanel,
  ReportDashboardPanel,
  reportParameters,
  NotificationPanel,
  SkillAdminPanel,
  SkillMatrixPanel,
  TrainingMaterialPanel,
  TrainingPlanPanel,
  WebhookSettingsPanel,
} from "./app";

describe("application shell", () => {
  test("exposes the phase-one factory management areas", () => {
    const html = renderToStaticMarkup(
      <App
        initialSession={{
          accountId: "account-manager",
          employeeId: "employee-manager",
          employeeNumber: "M0001",
          displayName: "张明",
          role: "department_manager",
          mustChangePassword: false,
        }}
      />,
    );

    expect(html).toContain("技能矩阵");
    expect(html).toContain("部门概况");
    expect(html).toContain("部门员工");
    expect(html).toContain("技能矩阵");
    expect(html).toContain("培训管理");
    expect(html).toContain("评定确认");
    expect(html).toContain("张明");
  });

  test("blocks the business shell until an initial password is changed", () => {
    const html = renderToStaticMarkup(
      <App
        initialSession={{
          accountId: "account-employee",
          employeeId: "employee-employee",
          employeeNumber: "E0001",
          displayName: "李华",
          role: "employee",
          mustChangePassword: true,
        }}
      />,
    );

    expect(html).toContain("请先修改密码");
    expect(html).toContain("完成修改前不能进入业务页面");
    expect(html).toContain("退出当前账号");
    expect(html).not.toContain("我的技能差距");
  });

  test("shows an eight-character minimum on password forms", () => {
    const changePasswordHtml = renderToStaticMarkup(
      <App
        initialSession={{
          accountId: "account-employee",
          employeeId: "employee-employee",
          employeeNumber: "E0001",
          displayName: "员工",
          role: "employee",
          mustChangePassword: true,
        }}
      />,
    );
    const resetPasswordHtml = renderToStaticMarkup(
      <App
        initialSession={{
          accountId: "account-admin",
          employeeId: "employee-admin",
          employeeNumber: "A0001",
          displayName: "管理员",
          role: "system_admin",
          mustChangePassword: false,
        }}
      />,
    );

    expect(changePasswordHtml).toContain("新密码至少 8 位");
    expect(changePasswordHtml.match(/minLength="8"/g)).toHaveLength(2);
    expect(changePasswordHtml.match(/maxLength="200"/g)).toHaveLength(2);
    expect(resetPasswordHtml).toContain('minLength="8"');
    expect(resetPasswordHtml).toContain('maxLength="200"');
  });

  test("shows employees only their own training and skill reminders", () => {
    const html = renderToStaticMarkup(
      <App
        initialSession={{
          accountId: "account-employee",
          employeeId: "employee-employee",
          employeeNumber: "E0001",
          displayName: "李华",
          role: "employee",
          mustChangePassword: false,
        }}
      />,
    );

    expect(html).toContain("只展示与你本人有关的培训与技能事项");
    expect(html).toContain("设备点检规范");
    expect(html).not.toContain("王强等 4 人");
    expect(html).toContain('aria-label="退出登录"');
  });

  test("gives the system administrator an account reset form", () => {
    const html = renderToStaticMarkup(
      <App
        initialSession={{
          accountId: "account-admin",
          employeeId: "employee-admin",
          employeeNumber: "A0001",
          displayName: "系统管理员",
          role: "system_admin",
          mustChangePassword: false,
        }}
      />,
    );

    expect(html).toContain("账号管理");
    expect(html).toContain("重置密码");
    expect(html).toContain("旧会话失效");
    expect(html).toContain("正在加载账号");
  });

  test("organization list has an explicit loading state before data arrives", () => {
    const html = renderToStaticMarkup(<OrganizationPanel canManage />);
    expect(html).toContain("正在加载组织人员");
  });

  test("skill lists expose loading states before data arrives", () => {
    expect(renderToStaticMarkup(<SkillAdminPanel />)).toContain("正在加载技能标准");
    expect(renderToStaticMarkup(<SkillMatrixPanel personal />)).toContain("正在加载技能矩阵");
    expect(renderToStaticMarkup(<ReportDashboardPanel />)).toContain(
      "正在加载 Dashboard 与技能矩阵",
    );
  });

  test("report export parameters stay tied to the applied dashboard filters", () => {
    const applied = {
      departmentId: "department-1",
      positionId: "",
      employeeId: "",
      skillId: "skill-1",
      status: "met",
      validity: "",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      sortBy: "skillCode",
      sortOrder: "desc",
    };
    expect(reportParameters(applied).toString()).toBe(
      "departmentId=department-1&skillId=skill-1&status=met&dateFrom=2026-07-01&dateTo=2026-07-31&sortBy=skillCode&sortOrder=desc",
    );
  });

  test("report browser view renders metrics, drilldown rows, mobile cards and matching export URL", () => {
    const filters = {
      departmentId: "department-1",
      positionId: "position-1",
      employeeId: "",
      skillId: "skill-1",
      status: "met",
      validity: "effective",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      sortBy: "skillCode",
      sortOrder: "desc",
    };
    const html = renderToStaticMarkup(
      <ReportDashboardPanel
        initialFilters={filters}
        initialReport={{
          generatedAt: "2026-07-28T00:00:00.000Z",
          metrics: {
            positionSkillCompliance: { numerator: 1, denominator: 2, rate: 0.5 },
            departmentSkillCoverage: { numerator: 1, denominator: 1, rate: 1 },
            trainingCompletion: { numerator: 2, denominator: 3, rate: 2 / 3 },
            expiringSoonCount: 1,
            expiredCount: 0,
          },
          rows: [
            {
              employeeId: "employee-1",
              employeeNumber: "E001",
              employeeName: "李华",
              departmentId: "department-1",
              departmentName: "制造部",
              positionId: "position-1",
              positionName: "操作工",
              skillId: "skill-1",
              skillCode: "S001",
              skillName: "设备点检",
              requiredLevel: 2,
              required: true,
              currentLevel: 2,
              validityStatus: "effective",
              status: "met",
              gap: 0,
            },
          ],
        }}
      />,
    );
    expect(html).toContain("岗位技能达标率");
    expect(html).toContain("50.0%");
    expect(html).toContain("设备点检");
    expect(html).toContain('class="matrix-cards"');
    expect(html).toContain(
      `/api/reports/export.xlsx?${reportParameters(filters)}`.replaceAll("&", "&amp;"),
    );
  });

  test("training workspace exposes explicit loading states for employee mobile use", () => {
    const employee: Parameters<typeof TrainingPlanPanel>[0]["session"] = {
      accountId: "account-employee",
      employeeId: "employee-employee",
      employeeNumber: "E0001",
      displayName: "李华",
      role: "employee",
      mustChangePassword: false,
    };
    expect(renderToStaticMarkup(<TrainingPlanPanel session={employee} />)).toContain(
      "正在加载培训计划与任务",
    );
    expect(renderToStaticMarkup(<TrainingMaterialPanel canManage={false} />)).toContain(
      "正在加载培训资料",
    );
    expect(renderToStaticMarkup(<AssessmentPanel session={employee} />)).toContain(
      "正在加载技能评定",
    );
    expect(renderToStaticMarkup(<NotificationPanel />)).toContain("正在加载消息通知");
    expect(renderToStaticMarkup(<WebhookSettingsPanel />)).toContain(
      "正在加载 Webhook 配置与发送记录",
    );
    expect(renderToStaticMarkup(<AuditPanel />)).toContain("正在加载审计日志");
  });
});
