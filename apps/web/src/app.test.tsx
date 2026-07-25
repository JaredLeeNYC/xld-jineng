import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./app";

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
});
