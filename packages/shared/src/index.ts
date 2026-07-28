export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export type ReadinessResult =
  | { ok: true }
  | {
      ok: false;
      reason: "database-unavailable" | "migration-mismatch";
      message: string;
    };

export type ReadinessProbe = () => Promise<ReadinessResult>;

export const fixedRoles = [
  "employee",
  "department_manager",
  "hr_admin",
  "executive_viewer",
  "system_admin",
] as const;

export type FixedRole = (typeof fixedRoles)[number];

export const permissions = [
  "self:read",
  "training:self-submit",
  "department:read",
  "department:manage",
  "factory:read",
  "factory:manage",
  "report:export",
  "system:manage",
] as const;

export type Permission = (typeof permissions)[number];

const rolePermissions: Record<FixedRole, readonly Permission[]> = {
  employee: ["self:read", "training:self-submit"],
  department_manager: ["self:read", "training:self-submit", "department:read", "department:manage"],
  hr_admin: ["self:read", "factory:read", "factory:manage", "report:export"],
  executive_viewer: ["factory:read", "report:export"],
  system_admin: ["factory:read", "system:manage"],
};

export const permissionsForRole = (role: FixedRole): readonly Permission[] => rolePermissions[role];

export const hasPermission = (role: FixedRole, permission: Permission): boolean =>
  rolePermissions[role].includes(permission);

export type NavigationItem = {
  id: string;
  label: string;
  access: "read" | "write";
};

const roleNavigation: Record<FixedRole, readonly NavigationItem[]> = {
  employee: [
    { id: "my-workspace", label: "我的工作台", access: "read" },
    { id: "my-skills", label: "我的技能", access: "read" },
    { id: "my-training", label: "我的培训", access: "write" },
    { id: "notifications", label: "消息通知", access: "read" },
  ],
  department_manager: [
    { id: "dashboard", label: "部门概况", access: "read" },
    { id: "employees", label: "部门员工", access: "read" },
    { id: "matrix", label: "技能矩阵", access: "read" },
    { id: "training", label: "培训管理", access: "write" },
    { id: "assessments", label: "评定确认", access: "write" },
  ],
  hr_admin: [
    { id: "dashboard", label: "全厂概况", access: "read" },
    { id: "organization", label: "组织人员", access: "write" },
    { id: "skills", label: "技能标准", access: "write" },
    { id: "training", label: "培训管理", access: "write" },
    { id: "assessments", label: "评定归档", access: "write" },
    { id: "reports", label: "报表导出", access: "read" },
  ],
  executive_viewer: [
    { id: "dashboard", label: "全厂概况", access: "read" },
    { id: "matrix", label: "技能矩阵", access: "read" },
    { id: "reports", label: "报表导出", access: "read" },
  ],
  system_admin: [
    { id: "accounts", label: "账号管理", access: "write" },
    { id: "settings", label: "系统设置", access: "write" },
    { id: "audit", label: "审计日志", access: "read" },
  ],
};

export const navigationForRole = (role: FixedRole): readonly NavigationItem[] =>
  roleNavigation[role];

export const success = <T>(data: T): ApiSuccess<T> => ({
  ok: true,
  data,
});

export const failure = (code: string, message: string): ApiError => ({
  ok: false,
  error: {
    code,
    message,
  },
});

export * from "./organization";
