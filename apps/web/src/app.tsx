import {
  navigationForRole,
  maximumPasswordLength,
  minimumPasswordLength,
  assessmentMethodLabels,
  assessmentStatusLabels,
  skillCategoryLabels,
  skillLevelMeanings,
  type FixedRole,
  type NavigationItem,
  type PositionSkillRequirementView,
  type SkillCategory,
  type SkillMatrixCell,
  type SkillView,
  type SkillAssessmentView,
  type AssessmentMethod,
  type TrainingMaterialView,
  type TrainingPlanView,
  type TrainingScopeType,
  type TrainingTaskView,
  type DashboardMetrics,
} from "@jineng/skill-matrix-shared";
import {
  Bell,
  BookOpenCheck,
  ChevronRight,
  ClipboardCheck,
  Factory,
  GraduationCap,
  LayoutDashboard,
  LockKeyhole,
  LogIn,
  Search,
  Settings,
  ShieldCheck,
  TrendingUp,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

export type Session = {
  accountId: string;
  employeeId: string;
  employeeNumber: string;
  displayName: string;
  departmentId?: string;
  role: FixedRole;
  mustChangePassword: boolean;
};

type AccountSummary = {
  accountId: string;
  employeeNumber: string;
  displayName: string;
  role: FixedRole;
  active: boolean;
  mustChangePassword: boolean;
};

type Department = { id: string; code: string; name: string; active: boolean };
type Position = {
  id: string;
  code: string;
  name: string;
  departmentId: string;
  departmentName: string;
  active: boolean;
};
type Employee = {
  id: string;
  employeeNumber: string;
  displayName: string;
  departmentId?: string;
  departmentName?: string;
  positionId?: string;
  positionName?: string;
  hireDate?: string;
  phone?: string;
  active: boolean;
};
type ImportPreview = {
  previewId: string;
  totalRows: number;
  validRows: number;
  errors: Array<{ rowNumber: number; field: string; message: string }>;
};
type PositionAssignment = {
  id: string;
  departmentName: string;
  positionName: string;
  startedAt: string;
  endedAt?: string;
  reason: string;
};

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

const request = async <T,>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; result: ApiResult<T> }> => {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers,
  });
  return {
    status: response.status,
    result: (await response.json()) as ApiResult<T>,
  };
};

const iconByNavigation: Record<string, LucideIcon> = {
  "my-workspace": LayoutDashboard,
  profile: UserRound,
  "my-skills": BookOpenCheck,
  "my-training": GraduationCap,
  "my-assessments": ClipboardCheck,
  notifications: Bell,
  dashboard: LayoutDashboard,
  employees: UsersRound,
  matrix: BookOpenCheck,
  training: GraduationCap,
  assessments: ClipboardCheck,
  organization: UsersRound,
  skills: BookOpenCheck,
  reports: TrendingUp,
  accounts: UserRound,
  settings: Settings,
  audit: ShieldCheck,
};

const roleLabel: Record<FixedRole, string> = {
  employee: "员工",
  department_manager: "部门主管",
  hr_admin: "HR / 培训管理员",
  executive_viewer: "高层查看者",
  system_admin: "系统管理员",
};

function LoginPage({ onLoggedIn }: { onLoggedIn: (session: Session) => void }) {
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const { result } = await request<Session>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ employeeNumber, password }),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onLoggedIn(result.data);
    } catch {
      setError("暂时无法连接服务器，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="auth-brand-content">
          <span className="brand-mark">
            <Factory size={24} />
          </span>
          <p>示范制造工厂</p>
          <h1>
            让每一项能力
            <br />
            都有据可查
          </h1>
          <span>员工培训、技能评定与岗位矩阵统一管理</span>
        </div>
      </section>
      <section className="auth-form-wrap">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-mobile-brand">
            <Factory size={20} />
            <strong>技能矩阵</strong>
          </div>
          <p className="eyebrow">SKILL MATRIX</p>
          <h2>登录技能矩阵</h2>
          <p className="auth-help">使用工号和密码进入你的工作空间</p>
          <label>
            <span>工号</span>
            <input
              autoComplete="username"
              autoFocus
              maxLength={50}
              onChange={(event) => setEmployeeNumber(event.target.value)}
              placeholder="请输入工号"
              required
              value={employeeNumber}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              maxLength={200}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              required
              type="password"
              value={password}
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="auth-submit" disabled={submitting} type="submit">
            <LogIn size={18} />
            {submitting ? "正在登录…" : "登录"}
          </button>
          <small className="auth-note">连续 5 次登录失败后，账号将临时锁定 15 分钟</small>
        </form>
      </section>
    </main>
  );
}

function PasswordChangePage({
  onChanged,
  onLoggedOut,
  session,
}: {
  onChanged: (session: Session) => void;
  onLoggedOut: () => void;
  session: Session;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("两次输入的新密码不一致");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const { result } = await request<Session>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onChanged(result.data);
    } catch {
      setError("暂时无法连接服务器，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    await request("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    onLoggedOut();
  };

  return (
    <main className="password-page">
      <form className="auth-card password-card" onSubmit={submit}>
        <span className="security-mark">
          <LockKeyhole size={23} />
        </span>
        <p className="eyebrow">首次登录保护</p>
        <h2>{session.displayName}，请先修改密码</h2>
        <p className="auth-help">
          新密码至少 {minimumPasswordLength} 位，最多 {maximumPasswordLength} 位。完成修改前不能进入业务页面。
        </p>
        <label>
          <span>当前密码</span>
          <input
            autoComplete="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            type="password"
          />
        </label>
        <label>
          <span>新密码</span>
          <input
            autoComplete="new-password"
            minLength={minimumPasswordLength}
            maxLength={maximumPasswordLength}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            type="password"
          />
        </label>
        <label>
          <span>再次输入新密码</span>
          <input
            autoComplete="new-password"
            minLength={minimumPasswordLength}
            maxLength={maximumPasswordLength}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            type="password"
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="auth-submit" disabled={submitting} type="submit">
          <ShieldCheck size={18} />
          {submitting ? "正在保存…" : "保存并进入系统"}
        </button>
        <button className="auth-secondary" onClick={logout} type="button">
          退出当前账号
        </button>
      </form>
    </main>
  );
}

const statisticsForRole = (role: FixedRole) => {
  if (role === "employee") {
    return [
      { label: "已掌握技能", value: "12", note: "其中 8 项达到岗位要求", tone: "green" },
      { label: "待完成培训", value: "3", note: "最近一项截止本周五", tone: "amber" },
      { label: "即将到期", value: "1", note: "焊接操作将在 28 天后到期", tone: "red" },
      { label: "未读消息", value: "2", note: "培训安排与评定结果", tone: "blue" },
    ];
  }
  if (role === "system_admin") {
    return [
      { label: "启用账号", value: "286", note: "五类固定角色", tone: "green" },
      { label: "临时锁定", value: "2", note: "15 分钟后自动解除", tone: "amber" },
      { label: "今日安全事件", value: "9", note: "无高风险事件", tone: "blue" },
      { label: "服务状态", value: "正常", note: "数据库与迁移已就绪", tone: "green" },
    ];
  }
  return [
    { label: "在岗员工", value: "286", note: "本月新增 8 人", tone: "green" },
    { label: "技能达标率", value: "82.6%", note: "较上月 +3.2%", tone: "amber" },
    { label: "待确认评定", value: "6", note: "其中 2 项即将超期", tone: "red" },
    { label: "培训完成率", value: "91.4%", note: "本月任务 128 项", tone: "blue" },
  ];
};

const departments = [
  { name: "装配一部", people: 68, rate: 91, color: "var(--green)" },
  { name: "机加车间", people: 54, rate: 84, color: "var(--amber)" },
  { name: "质量部", people: 32, rate: 79, color: "var(--blue)" },
  { name: "装配二部", people: 71, rate: 73, color: "var(--coral)" },
];

function NavigationButton({
  active,
  item,
  onSelect,
}: {
  active: boolean;
  item: NavigationItem;
  onSelect: () => void;
}) {
  const Icon = iconByNavigation[item.id] ?? LayoutDashboard;
  return (
    <button
      aria-label={item.label}
      className={`nav-item${active ? " active" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <Icon size={19} />
      <span>{item.label}</span>
    </button>
  );
}

function AdminResetPanel() {
  const [accounts, setAccounts] = useState<AccountSummary[] | undefined>();
  const [accountId, setAccountId] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void request<AccountSummary[]>("/api/admin/accounts")
      .then(({ result }) => {
        if (!result.ok) {
          setLoadError(result.error.message);
          return;
        }
        setAccounts(result.data);
        setAccountId(result.data[0]?.accountId ?? "");
      })
      .catch(() => setLoadError("暂时无法读取账号列表"));
  }, []);

  const reset = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    try {
      const { result } = await request<{ accountId: string }>(
        `/api/admin/accounts/${accountId}/reset-password`,
        {
          method: "POST",
          body: JSON.stringify({ temporaryPassword }),
        },
      );
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setTemporaryPassword("");
      setMessage("临时密码已重置，该账号下次登录时必须修改密码。");
    } catch {
      setMessage("暂时无法连接服务器，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="panel matrix-panel">
      <div className="panel-heading">
        <div>
          <h2>账号管理</h2>
          <p>重置临时密码并立即使旧会话失效</p>
        </div>
      </div>
      <form className="admin-reset-form" onSubmit={reset}>
        {!accounts && !loadError && <p className="list-state">正在加载账号…</p>}
        {loadError && (
          <p className="form-error" role="alert">
            {loadError}
          </p>
        )}
        {accounts?.length === 0 && <p className="list-state">当前没有可管理的账号</p>}
        {accounts && accounts.length > 0 && (
          <label>
            员工账号
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => (
                <option value={account.accountId} key={account.accountId}>
                  {account.employeeNumber} · {account.displayName} · {roleLabel[account.role]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          临时密码
          <input
            minLength={minimumPasswordLength}
            maxLength={maximumPasswordLength}
            required
            type="password"
            value={temporaryPassword}
            onChange={(event) => setTemporaryPassword(event.target.value)}
          />
        </label>
        <button className="primary-button" disabled={!accountId || submitting} type="submit">
          <LockKeyhole size={17} />
          {submitting ? "正在重置…" : "重置密码"}
        </button>
        {message && <p className="form-message">{message}</p>}
      </form>
    </section>
  );
}

export function OrganizationPanel({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; departments: Department[]; positions: Position[]; employees: Employee[] }
  >({ status: "loading" });
  const [query, setQuery] = useState("");
  const [masterQuery, setMasterQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [departmentForm, setDepartmentForm] = useState({ code: "", name: "" });
  const [positionForm, setPositionForm] = useState({ code: "", name: "", departmentId: "" });
  const [employeeForm, setEmployeeForm] = useState({
    employeeNumber: "",
    displayName: "",
    departmentCode: "",
    positionCode: "",
  });
  const [editing, setEditing] = useState<Employee>();
  const [editingDepartment, setEditingDepartment] = useState<Department>();
  const [editingPosition, setEditingPosition] = useState<Position>();
  const [history, setHistory] = useState<{
    employee: Employee;
    assignments?: PositionAssignment[];
    error?: string;
  }>();
  const [assignment, setAssignment] = useState({ departmentId: "", positionId: "", reason: "" });
  const [importFile, setImportFile] = useState<File>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [credentials, setCredentials] = useState<
    Array<{ employeeNumber: string; temporaryPassword: string }>
  >([]);

  const load = async () => {
    setState({ status: "loading" });
    try {
      if (!canManage) {
        const employees = await request<Employee[]>("/api/organization/employees");
        if (!employees.result.ok) {
          setState({ status: "error", message: employees.result.error.message });
          return;
        }
        setState({
          status: "ready",
          departments: [],
          positions: [],
          employees: employees.result.data,
        });
        return;
      }
      const [departments, positions, employees] = await Promise.all([
        request<Department[]>("/api/organization/departments?includeInactive=true"),
        request<Position[]>("/api/organization/positions?includeInactive=true"),
        request<Employee[]>("/api/organization/employees"),
      ]);
      if (!departments.result.ok || !positions.result.ok || !employees.result.ok) {
        const failed = [departments.result, positions.result, employees.result].find(
          (result) => !result.ok,
        );
        setState({
          status: "error",
          message: failed && !failed.ok ? failed.error.message : "组织数据加载失败",
        });
        return;
      }
      const departmentRows = departments.result.data;
      setState({
        status: "ready",
        departments: departmentRows,
        positions: positions.result.data,
        employees: employees.result.data,
      });
      setPositionForm((current) => ({
        ...current,
        departmentId: current.departmentId || departmentRows[0]?.id || "",
      }));
    } catch {
      setState({ status: "error", message: "暂时无法连接组织服务" });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const mutate = async (path: string, method: string, body?: unknown) => {
    setNotice("");
    try {
      const { result } = await request(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!result.ok) {
        setNotice(result.error.message);
        return false;
      }
      setNotice("保存成功");
      await load();
      return true;
    } catch {
      setNotice("操作失败，请稍后再试");
      return false;
    }
  };

  const dryRun = async (event: FormEvent) => {
    event.preventDefault();
    if (!importFile) return;
    const form = new FormData();
    form.set("file", importFile);
    const { result } = await request<ImportPreview>("/api/organization/employees/import/dry-run", {
      method: "POST",
      body: form,
    });
    if (result.ok) setPreview(result.data);
    else setNotice(result.error.message);
  };

  const confirmImport = async () => {
    if (!preview) return;
    const { result } = await request<{
      imported: number;
      credentials: Array<{ employeeNumber: string; temporaryPassword: string }>;
    }>(`/api/organization/employees/import/${preview.previewId}/confirm`, { method: "POST" });
    if (!result.ok) {
      setNotice(result.error.message);
      return;
    }
    setCredentials(result.data.credentials);
    setPreview(undefined);
    setNotice(`已导入 ${result.data.imported} 名员工；临时凭证仅在本页显示一次。`);
    await load();
  };

  const showHistory = async (employee: Employee) => {
    setHistory({ employee });
    const { result } = await request<PositionAssignment[]>(
      `/api/organization/employees/${employee.id}/assignments`,
    );
    setHistory(
      result.ok
        ? { employee, assignments: result.data }
        : { employee, error: result.error.message },
    );
  };

  if (state.status === "loading") {
    return <section className="panel list-state-panel">正在加载组织人员…</section>;
  }
  if (state.status === "error") {
    return (
      <section className="panel list-state-panel" role="alert">
        <p>{state.message}</p>
        <button className="primary-button" onClick={load} type="button">
          重新加载
        </button>
      </section>
    );
  }

  const filteredEmployees = state.employees.filter((employee) =>
    `${employee.employeeNumber} ${employee.displayName} ${employee.departmentName ?? ""} ${employee.positionName ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const activePositions = state.positions.filter(
    (position) =>
      position.active &&
      (!assignment.departmentId || position.departmentId === assignment.departmentId),
  );
  const normalizedMasterQuery = masterQuery.trim().toLowerCase();
  const filteredDepartments = state.departments.filter((department) =>
    `${department.code} ${department.name}`.toLowerCase().includes(normalizedMasterQuery),
  );
  const filteredPositions = state.positions.filter((position) =>
    `${position.code} ${position.name} ${position.departmentName}`
      .toLowerCase()
      .includes(normalizedMasterQuery),
  );
  const employeeActions = (employee: Employee) => (
    <>
      <button type="button" onClick={() => void showHistory(employee)}>
        履历
      </button>
      {canManage && employee.active && (
        <>
          <button
            type="button"
            onClick={() => {
              setEditing(employee);
              setAssignment({
                departmentId: employee.departmentId ?? "",
                positionId: employee.positionId ?? "",
                reason: "",
              });
            }}
          >
            编辑
          </button>
          <button
            type="button"
            onClick={() =>
              void mutate(`/api/organization/employees/${employee.id}/deactivate`, "POST")
            }
          >
            停用
          </button>
        </>
      )}
    </>
  );
  const departmentActions = (department: Department) =>
    department.active ? (
      <>
        <button type="button" onClick={() => setEditingDepartment(department)}>
          编辑
        </button>
        <button
          type="button"
          onClick={() =>
            void mutate(`/api/organization/departments/${department.id}/deactivate`, "POST")
          }
        >
          停用
        </button>
      </>
    ) : null;
  const positionActions = (position: Position) =>
    position.active ? (
      <>
        <button type="button" onClick={() => setEditingPosition(position)}>
          编辑
        </button>
        <button
          type="button"
          onClick={() =>
            void mutate(`/api/organization/positions/${position.id}/deactivate`, "POST")
          }
        >
          停用
        </button>
      </>
    ) : null;

  return (
    <div className="organization-page">
      <section className="welcome organization-heading">
        <div>
          <p className="eyebrow">组织与人员</p>
          <h1>工厂人员与岗位</h1>
          <p>维护稳定业务编码、当前岗位与可追溯任职履历。</p>
        </div>
        <a
          className="primary-button export-link"
          href={`/api/organization/employees/export.xlsx${query ? `?query=${encodeURIComponent(query)}` : ""}`}
        >
          导出当前数据
        </a>
      </section>

      {notice && <p className="organization-notice">{notice}</p>}
      {credentials.length > 0 && (
        <section className="panel credential-panel">
          <h2>一次性初始凭证</h2>
          <p>请安全交付员工，离开本页后系统不再提供明文密码。</p>
          {credentials.map((item) => (
            <code key={item.employeeNumber}>
              {item.employeeNumber}　{item.temporaryPassword}
            </code>
          ))}
          <button type="button" onClick={() => setCredentials([])}>
            已完成交付
          </button>
        </section>
      )}

      {canManage && (
        <section className="organization-form-grid">
          <form
            className="panel compact-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await mutate("/api/organization/departments", "POST", departmentForm)) {
                setDepartmentForm({ code: "", name: "" });
              }
            }}
          >
            <h2>新增部门</h2>
            <input
              placeholder="部门编码"
              required
              value={departmentForm.code}
              onChange={(event) =>
                setDepartmentForm({ ...departmentForm, code: event.target.value })
              }
            />
            <input
              placeholder="部门名称"
              required
              value={departmentForm.name}
              onChange={(event) =>
                setDepartmentForm({ ...departmentForm, name: event.target.value })
              }
            />
            <button className="primary-button" type="submit">
              保存部门
            </button>
          </form>
          <form
            className="panel compact-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await mutate("/api/organization/positions", "POST", positionForm)) {
                setPositionForm({
                  code: "",
                  name: "",
                  departmentId: state.departments[0]?.id ?? "",
                });
              }
            }}
          >
            <h2>新增岗位</h2>
            <input
              placeholder="岗位编码"
              required
              value={positionForm.code}
              onChange={(event) => setPositionForm({ ...positionForm, code: event.target.value })}
            />
            <input
              placeholder="岗位名称"
              required
              value={positionForm.name}
              onChange={(event) => setPositionForm({ ...positionForm, name: event.target.value })}
            />
            <select
              required
              value={positionForm.departmentId}
              onChange={(event) =>
                setPositionForm({ ...positionForm, departmentId: event.target.value })
              }
            >
              {state.departments
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
            </select>
            <button className="primary-button" type="submit">
              保存岗位
            </button>
          </form>
          <form
            className="panel compact-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setNotice("");
              try {
                const { result } = await request<{
                  imported: number;
                  credentials: Array<{ employeeNumber: string; temporaryPassword: string }>;
                }>("/api/organization/employees", {
                  method: "POST",
                  body: JSON.stringify(employeeForm),
                });
                if (!result.ok) {
                  setNotice(result.error.message);
                  return;
                }
                setCredentials(result.data.credentials);
                setNotice("员工已创建；初始凭证仅在本页显示一次。");
                setEmployeeForm({
                  employeeNumber: "",
                  displayName: "",
                  departmentCode: "",
                  positionCode: "",
                });
                await load();
              } catch {
                setNotice("创建员工失败，请稍后再试");
              }
            }}
          >
            <h2>新增员工</h2>
            <input
              placeholder="工号"
              required
              value={employeeForm.employeeNumber}
              onChange={(event) =>
                setEmployeeForm({ ...employeeForm, employeeNumber: event.target.value })
              }
            />
            <input
              placeholder="姓名"
              required
              value={employeeForm.displayName}
              onChange={(event) =>
                setEmployeeForm({ ...employeeForm, displayName: event.target.value })
              }
            />
            <input
              placeholder="部门编码"
              required
              value={employeeForm.departmentCode}
              onChange={(event) =>
                setEmployeeForm({ ...employeeForm, departmentCode: event.target.value })
              }
            />
            <input
              placeholder="岗位编码"
              required
              value={employeeForm.positionCode}
              onChange={(event) =>
                setEmployeeForm({ ...employeeForm, positionCode: event.target.value })
              }
            />
            <button className="primary-button" type="submit">
              创建并生成账号
            </button>
          </form>
        </section>
      )}

      {canManage && (
        <section className="organization-master-grid">
          <label className="master-filter">
            筛选部门与岗位
            <input
              className="table-filter"
              placeholder="输入编码、名称或所属部门"
              value={masterQuery}
              onChange={(event) => setMasterQuery(event.target.value)}
            />
          </label>
          <section className="panel master-list">
            <div className="panel-heading">
              <div>
                <h2>部门</h2>
                <p>停用后不影响历史记录</p>
              </div>
            </div>
            {filteredDepartments.length === 0 ? (
              <p className="list-state">当前筛选暂无部门</p>
            ) : (
              <>
                <div className="master-table-wrap">
                  <table className="master-table">
                    <thead>
                      <tr>
                        <th>编码</th>
                        <th>名称</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDepartments.map((department) => (
                        <tr key={department.id}>
                          <td>{department.code}</td>
                          <td>{department.name}</td>
                          <td>{department.active ? "启用" : "停用"}</td>
                          <td>{departmentActions(department)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="master-cards">
                  {filteredDepartments.map((department) => (
                    <article className="master-card" key={department.id}>
                      <header>
                        <strong>{department.name}</strong>
                        <span>{department.code}</span>
                      </header>
                      <p>{department.active ? "启用" : "停用"}</p>
                      <footer>{departmentActions(department)}</footer>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
          <section className="panel master-list">
            <div className="panel-heading">
              <div>
                <h2>岗位</h2>
                <p>岗位编码作为稳定业务键</p>
              </div>
            </div>
            {filteredPositions.length === 0 ? (
              <p className="list-state">当前筛选暂无岗位</p>
            ) : (
              <>
                <div className="master-table-wrap">
                  <table className="master-table">
                    <thead>
                      <tr>
                        <th>编码 / 岗位</th>
                        <th>部门</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPositions.map((position) => (
                        <tr key={position.id}>
                          <td>
                            {position.code} · {position.name}
                          </td>
                          <td>{position.departmentName}</td>
                          <td>{position.active ? "启用" : "停用"}</td>
                          <td>{positionActions(position)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="master-cards">
                  {filteredPositions.map((position) => (
                    <article className="master-card" key={position.id}>
                      <header>
                        <strong>{position.name}</strong>
                        <span>{position.code}</span>
                      </header>
                      <p>
                        {position.departmentName} · {position.active ? "启用" : "停用"}
                      </p>
                      <footer>{positionActions(position)}</footer>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </section>
      )}

      {editingDepartment && (
        <form
          className="panel inline-editor"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await mutate(`/api/organization/departments/${editingDepartment.id}`, "PATCH", {
                name: editingDepartment.name,
              })
            ) {
              setEditingDepartment(undefined);
            }
          }}
        >
          <strong>编辑部门 {editingDepartment.code}</strong>
          <input
            value={editingDepartment.name}
            onChange={(event) =>
              setEditingDepartment({ ...editingDepartment, name: event.target.value })
            }
          />
          <button className="primary-button" type="submit">
            保存
          </button>
          <button type="button" onClick={() => setEditingDepartment(undefined)}>
            取消
          </button>
        </form>
      )}

      {editingPosition && (
        <form
          className="panel inline-editor"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await mutate(`/api/organization/positions/${editingPosition.id}`, "PATCH", {
                name: editingPosition.name,
                departmentId: editingPosition.departmentId,
              })
            ) {
              setEditingPosition(undefined);
            }
          }}
        >
          <strong>编辑岗位 {editingPosition.code}</strong>
          <input
            value={editingPosition.name}
            onChange={(event) =>
              setEditingPosition({ ...editingPosition, name: event.target.value })
            }
          />
          <span className="locked-field">所属部门：{editingPosition.departmentName}</span>
          <button className="primary-button" type="submit">
            保存
          </button>
          <button type="button" onClick={() => setEditingPosition(undefined)}>
            取消
          </button>
        </form>
      )}

      {canManage && (
        <form className="panel import-panel" onSubmit={dryRun}>
          <div>
            <h2>Excel 批量导入</h2>
            <p>先预检，全部通过后才能事务性写入。</p>
          </div>
          <input
            accept=".xlsx"
            onChange={(event) => setImportFile(event.target.files?.[0])}
            type="file"
          />
          <button className="primary-button" disabled={!importFile} type="submit">
            预检文件
          </button>
          {preview && (
            <div className="import-preview">
              <strong>
                {preview.totalRows} 行，{preview.validRows} 行有效
              </strong>
              {preview.errors.length === 0 ? (
                <button className="primary-button" onClick={confirmImport} type="button">
                  确认正式导入
                </button>
              ) : (
                <ul>
                  {preview.errors.slice(0, 20).map((error) => (
                    <li key={`${error.rowNumber}-${error.field}`}>
                      第 {error.rowNumber} 行：{error.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
      )}

      {editing && canManage && (
        <section className="panel edit-employee-panel">
          <div className="panel-heading">
            <div>
              <h2>编辑 {editing.employeeNumber}</h2>
              <p>基本资料和岗位变更分别留痕</p>
            </div>
            <button type="button" onClick={() => setEditing(undefined)}>
              关闭
            </button>
          </div>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await mutate(`/api/organization/employees/${editing.id}`, "PATCH", {
                  displayName: editing.displayName,
                  hireDate: editing.hireDate,
                  phone: editing.phone,
                })
              )
                setEditing(undefined);
            }}
          >
            <input
              value={editing.displayName}
              onChange={(event) => setEditing({ ...editing, displayName: event.target.value })}
            />
            <input
              placeholder="入职日期 YYYY-MM-DD"
              value={editing.hireDate ?? ""}
              onChange={(event) => setEditing({ ...editing, hireDate: event.target.value })}
            />
            <input
              placeholder="手机号"
              value={editing.phone ?? ""}
              onChange={(event) => setEditing({ ...editing, phone: event.target.value })}
            />
            <button className="primary-button" type="submit">
              保存资料
            </button>
          </form>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await mutate(
                  `/api/organization/employees/${editing.id}/assignment`,
                  "POST",
                  assignment,
                )
              ) {
                setEditing(undefined);
                setAssignment({ departmentId: "", positionId: "", reason: "" });
              }
            }}
          >
            <select
              required
              value={assignment.departmentId}
              onChange={(event) =>
                setAssignment({
                  departmentId: event.target.value,
                  positionId: "",
                  reason: assignment.reason,
                })
              }
            >
              <option value="">选择部门</option>
              {state.departments
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
            <select
              required
              value={assignment.positionId}
              onChange={(event) => setAssignment({ ...assignment, positionId: event.target.value })}
            >
              <option value="">选择岗位</option>
              {activePositions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <input
              placeholder="岗位变更原因"
              required
              value={assignment.reason}
              onChange={(event) => setAssignment({ ...assignment, reason: event.target.value })}
            />
            <button className="primary-button" type="submit">
              变更岗位
            </button>
          </form>
        </section>
      )}

      {history && (
        <section className="panel assignment-history">
          <div className="panel-heading">
            <div>
              <h2>{history.employee.displayName}的岗位履历</h2>
              <p>{history.employee.employeeNumber}</p>
            </div>
            <button type="button" onClick={() => setHistory(undefined)}>
              关闭
            </button>
          </div>
          {history.error ? (
            <p className="form-error">{history.error}</p>
          ) : !history.assignments ? (
            <p className="list-state">正在加载岗位履历…</p>
          ) : history.assignments.length === 0 ? (
            <p className="list-state">暂无岗位履历</p>
          ) : (
            <>
              <div className="history-table-wrap">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>部门 / 岗位</th>
                      <th>开始</th>
                      <th>结束</th>
                      <th>变更原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.assignments.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.departmentName} · {item.positionName}
                        </td>
                        <td>{item.startedAt.slice(0, 10)}</td>
                        <td>{item.endedAt?.slice(0, 10) ?? "当前"}</td>
                        <td>{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="history-cards">
                {history.assignments.map((item) => (
                  <article className="history-card" key={item.id}>
                    <header>
                      <strong>{item.positionName}</strong>
                      <span>{item.departmentName}</span>
                    </header>
                    <p>
                      {item.startedAt.slice(0, 10)} 至 {item.endedAt?.slice(0, 10) ?? "当前"}
                    </p>
                    <small>{item.reason}</small>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <section className="panel employee-list-panel">
        <div className="panel-heading">
          <div>
            <h2>员工列表</h2>
            <p>{filteredEmployees.length} 名员工</p>
          </div>
          <input
            className="table-filter"
            placeholder="筛选工号、姓名、部门或岗位"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {filteredEmployees.length === 0 ? (
          <p className="list-state">当前筛选没有员工</p>
        ) : (
          <>
            <div className="employee-table-wrap">
              <table className="employee-table">
                <thead>
                  <tr>
                    <th>工号 / 姓名</th>
                    <th>部门</th>
                    <th>岗位</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((employee) => (
                    <tr key={employee.id}>
                      <td>
                        <strong>{employee.employeeNumber}</strong>
                        <small>{employee.displayName}</small>
                      </td>
                      <td>{employee.departmentName ?? "未分配"}</td>
                      <td>{employee.positionName ?? "未分配"}</td>
                      <td>{employee.active ? "在职" : "已停用"}</td>
                      <td>{employeeActions(employee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="employee-cards">
              {filteredEmployees.map((employee) => (
                <article className="employee-card" key={employee.id}>
                  <header>
                    <strong>{employee.displayName}</strong>
                    <span>{employee.employeeNumber}</span>
                  </header>
                  <dl>
                    <div>
                      <dt>部门</dt>
                      <dd>{employee.departmentName ?? "未分配"}</dd>
                    </div>
                    <div>
                      <dt>岗位</dt>
                      <dd>{employee.positionName ?? "未分配"}</dd>
                    </div>
                    <div>
                      <dt>状态</dt>
                      <dd>{employee.active ? "在职" : "已停用"}</dd>
                    </div>
                  </dl>
                  <footer>{employeeActions(employee)}</footer>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function SkillAdminPanel() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | {
        status: "ready";
        skills: SkillView[];
        positions: Position[];
        requirements: PositionSkillRequirementView[];
      }
  >({ status: "loading" });
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [skillForm, setSkillForm] = useState<{
    code: string;
    name: string;
    category: SkillCategory;
    reassessmentRequired: boolean;
    validityMonths: number;
  }>({
    code: "",
    name: "",
    category: "professional",
    reassessmentRequired: false,
    validityMonths: 12,
  });
  const [requirement, setRequirement] = useState({
    positionId: "",
    skillId: "",
    requiredLevel: 2,
    required: true,
  });
  const [copyForm, setCopyForm] = useState({
    sourcePositionId: "",
    targetPositionId: "",
    levelDelta: 0,
  });
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [editingSkill, setEditingSkill] = useState<SkillView>();

  const load = async () => {
    setState({ status: "loading" });
    try {
      const [skills, positions, requirements] = await Promise.all([
        request<SkillView[]>("/api/skills?includeInactive=true"),
        request<Position[]>("/api/organization/positions?includeInactive=true"),
        request<PositionSkillRequirementView[]>("/api/position-skill-requirements"),
      ]);
      const failed = [skills.result, positions.result, requirements.result].find(
        (item) => !item.ok,
      );
      if (failed && !failed.ok) {
        setState({ status: "error", message: failed.error.message });
        return;
      }
      if (!skills.result.ok || !positions.result.ok || !requirements.result.ok) return;
      setState({
        status: "ready",
        skills: skills.result.data,
        positions: positions.result.data,
        requirements: requirements.result.data,
      });
      const firstPosition = positions.result.data.find((item) => item.active)?.id ?? "";
      const firstSkill = skills.result.data.find((item) => item.active)?.id ?? "";
      setRequirement((current) => ({
        ...current,
        positionId: current.positionId || firstPosition,
        skillId: current.skillId || firstSkill,
      }));
      setCopyForm((current) => ({
        ...current,
        sourcePositionId: current.sourcePositionId || firstPosition,
        targetPositionId: current.targetPositionId || firstPosition,
      }));
    } catch {
      setState({ status: "error", message: "暂时无法连接技能服务" });
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const mutate = async (path: string, method: string, body?: unknown) => {
    const { result } = await request(path, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!result.ok) {
      setNotice(result.error.message);
      return false;
    }
    setNotice("保存成功");
    await load();
    return true;
  };

  if (state.status === "loading")
    return <section className="panel list-state-panel">正在加载技能标准…</section>;
  if (state.status === "error")
    return (
      <section className="panel list-state-panel" role="alert">
        <p>{state.message}</p>
        <button className="primary-button" onClick={load} type="button">
          重新加载
        </button>
      </section>
    );
  const filtered = state.skills.filter((item) =>
    `${item.code} ${item.name} ${skillCategoryLabels[item.category]}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const activePositions = state.positions.filter((item) => item.active);
  const activeSkills = state.skills.filter((item) => item.active);

  return (
    <div className="skill-page">
      <section className="welcome">
        <div>
          <p className="eyebrow">技能标准</p>
          <h1>岗位技能标准</h1>
          <p>使用固定三级分类与 0–4 级定义，维护岗位达标口径。</p>
        </div>
      </section>
      {notice && <p className="organization-notice">{notice}</p>}
      <section className="skill-form-grid">
        <form
          className="panel compact-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await mutate("/api/skills", "POST", {
                ...skillForm,
                ...(skillForm.reassessmentRequired ? {} : { validityMonths: undefined }),
              })
            )
              setSkillForm({
                code: "",
                name: "",
                category: "professional",
                reassessmentRequired: false,
                validityMonths: 12,
              });
          }}
        >
          <h2>新增技能</h2>
          <input
            required
            placeholder="技能编码"
            value={skillForm.code}
            onChange={(event) => setSkillForm({ ...skillForm, code: event.target.value })}
          />
          <input
            required
            placeholder="技能名称"
            value={skillForm.name}
            onChange={(event) => setSkillForm({ ...skillForm, name: event.target.value })}
          />
          <select
            value={skillForm.category}
            onChange={(event) =>
              setSkillForm({ ...skillForm, category: event.target.value as SkillCategory })
            }
          >
            {Object.entries(skillCategoryLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={skillForm.reassessmentRequired}
              onChange={(event) =>
                setSkillForm({ ...skillForm, reassessmentRequired: event.target.checked })
              }
            />
            需要复评
          </label>
          {skillForm.reassessmentRequired && (
            <input
              type="number"
              min={1}
              max={120}
              value={skillForm.validityMonths}
              onChange={(event) =>
                setSkillForm({ ...skillForm, validityMonths: Number(event.target.value) })
              }
            />
          )}
          <button className="primary-button" type="submit">
            保存技能
          </button>
        </form>
        <form
          className="panel compact-form"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate("/api/position-skill-requirements", "PUT", requirement);
          }}
        >
          <h2>岗位要求</h2>
          <select
            required
            value={requirement.positionId}
            onChange={(event) => setRequirement({ ...requirement, positionId: event.target.value })}
          >
            {activePositions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.name}
              </option>
            ))}
          </select>
          <select
            required
            value={requirement.skillId}
            onChange={(event) => setRequirement({ ...requirement, skillId: event.target.value })}
          >
            {activeSkills.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.name}
              </option>
            ))}
          </select>
          <select
            value={requirement.requiredLevel}
            onChange={(event) =>
              setRequirement({ ...requirement, requiredLevel: Number(event.target.value) })
            }
          >
            {Object.entries(skillLevelMeanings).map(([level, meaning]) => (
              <option key={level} value={level}>
                {level} · {meaning}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={requirement.required}
              onChange={(event) =>
                setRequirement({ ...requirement, required: event.target.checked })
              }
            />
            必备技能
          </label>
          <button className="primary-button" type="submit">
            保存要求
          </button>
        </form>
        <form
          className="panel compact-form"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate("/api/position-skill-requirements/copy", "POST", copyForm);
          }}
        >
          <h2>复制岗位要求</h2>
          <select
            value={copyForm.sourcePositionId}
            onChange={(event) => setCopyForm({ ...copyForm, sourcePositionId: event.target.value })}
          >
            {activePositions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            value={copyForm.targetPositionId}
            onChange={(event) => setCopyForm({ ...copyForm, targetPositionId: event.target.value })}
          >
            {activePositions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label>
            统一调整等级
            <input
              type="number"
              min={-4}
              max={4}
              value={copyForm.levelDelta}
              onChange={(event) =>
                setCopyForm({ ...copyForm, levelDelta: Number(event.target.value) })
              }
            />
          </label>
          <button className="primary-button" type="submit">
            复制并调整
          </button>
        </form>
      </section>
      <section className="panel skill-catalog">
        <div className="panel-heading">
          <div>
            <h2>技能目录</h2>
            <p>共 {filtered.length} 项</p>
          </div>
          <input
            className="table-filter"
            placeholder="筛选编码、名称或分类"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {filtered.length === 0 ? (
          <p className="list-state">当前筛选暂无技能</p>
        ) : (
          <>
            <div className="skill-table-wrap">
              <table className="skill-table">
                <thead>
                  <tr>
                    <th>编码 / 名称</th>
                    <th>分类</th>
                    <th>复评</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((skill) => (
                    <tr key={skill.id}>
                      <td>
                        {skill.code} · {skill.name}
                      </td>
                      <td>{skillCategoryLabels[skill.category]}</td>
                      <td>
                        {skill.reassessmentRequired ? `${skill.validityMonths} 个月` : "无需"}
                      </td>
                      <td>{skill.active ? "启用" : "停用"}</td>
                      <td>
                        {skill.active && (
                          <>
                            <button type="button" onClick={() => setEditingSkill(skill)}>
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void mutate(`/api/skills/${skill.id}/deactivate`, "POST")
                              }
                            >
                              停用
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="skill-cards">
              {filtered.map((skill) => (
                <article className="skill-card" key={skill.id}>
                  <header>
                    <strong>{skill.name}</strong>
                    <span>{skill.code}</span>
                  </header>
                  <p>
                    {skillCategoryLabels[skill.category]} ·{" "}
                    {skill.reassessmentRequired ? `${skill.validityMonths} 个月复评` : "无需复评"} ·{" "}
                    {skill.active ? "启用" : "停用"}
                  </p>
                  {skill.active && (
                    <footer>
                      <button type="button" onClick={() => setEditingSkill(skill)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => void mutate(`/api/skills/${skill.id}/deactivate`, "POST")}
                      >
                        停用
                      </button>
                    </footer>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>
      {editingSkill && (
        <form
          className="panel inline-editor"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await mutate(`/api/skills/${editingSkill.id}`, "PATCH", {
                name: editingSkill.name,
                category: editingSkill.category,
                reassessmentRequired: editingSkill.reassessmentRequired,
                ...(editingSkill.reassessmentRequired
                  ? { validityMonths: editingSkill.validityMonths ?? 12 }
                  : {}),
              })
            )
              setEditingSkill(undefined);
          }}
        >
          <strong>编辑技能 {editingSkill.code}</strong>
          <input
            value={editingSkill.name}
            onChange={(event) => setEditingSkill({ ...editingSkill, name: event.target.value })}
          />
          <select
            value={editingSkill.category}
            onChange={(event) =>
              setEditingSkill({ ...editingSkill, category: event.target.value as SkillCategory })
            }
          >
            {Object.entries(skillCategoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={editingSkill.reassessmentRequired}
              onChange={(event) =>
                setEditingSkill({ ...editingSkill, reassessmentRequired: event.target.checked })
              }
            />
            需要复评
          </label>
          {editingSkill.reassessmentRequired && (
            <input
              type="number"
              min={1}
              max={120}
              value={editingSkill.validityMonths ?? 12}
              onChange={(event) =>
                setEditingSkill({ ...editingSkill, validityMonths: Number(event.target.value) })
              }
            />
          )}
          <button className="primary-button" type="submit">
            保存
          </button>
          <button type="button" onClick={() => setEditingSkill(undefined)}>
            取消
          </button>
        </form>
      )}
      <section className="panel requirement-list">
        <div className="panel-heading">
          <div>
            <h2>当前岗位要求</h2>
            <p>{state.requirements.length} 条唯一要求</p>
          </div>
        </div>
        {state.requirements.length === 0 ? (
          <p className="list-state">尚未配置岗位要求</p>
        ) : (
          <>
            <div className="requirement-table-wrap">
              <table className="skill-table">
                <thead>
                  <tr>
                    <th>岗位</th>
                    <th>技能</th>
                    <th>等级</th>
                    <th>类型</th>
                  </tr>
                </thead>
                <tbody>
                  {state.requirements.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.positionCode} · {item.positionName}
                      </td>
                      <td>
                        {item.skillCode} · {item.skillName}
                      </td>
                      <td>{item.requiredLevel}</td>
                      <td>{item.required ? "必备" : "非必备"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="requirement-cards">
              {state.requirements.map((item) => (
                <article key={item.id}>
                  <strong>
                    {item.positionName} · {item.skillName}
                  </strong>
                  <span>
                    要求 {item.requiredLevel} 级 · {item.required ? "必备" : "非必备"}
                  </span>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
      <form
        className="panel import-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!file) return;
          const body = new FormData();
          body.set("file", file);
          const { result } = await request<ImportPreview>("/api/skill-baselines/import/dry-run", {
            method: "POST",
            body,
          });
          if (result.ok) setPreview(result.data);
          else setNotice(result.error.message);
        }}
      >
        <div>
          <h2>初始技能 Excel</h2>
          <p>每行必须包含档案来源，预检通过后才归档。</p>
        </div>
        <input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0])} />
        <button className="primary-button" disabled={!file} type="submit">
          预检基线
        </button>
        {preview && (
          <div className="import-preview">
            <strong>
              {preview.totalRows} 行，{preview.validRows} 行有效
            </strong>
            {preview.errors.length === 0 ? (
              <button
                className="primary-button"
                type="button"
                onClick={async () => {
                  const { result } = await request<{ imported: number }>(
                    `/api/skill-baselines/import/${preview.previewId}/confirm`,
                    { method: "POST" },
                  );
                  if (result.ok) {
                    setNotice(`已归档 ${result.data.imported} 条初始技能`);
                    setPreview(undefined);
                  } else setNotice(result.error.message);
                }}
              >
                确认归档
              </button>
            ) : (
              <ul>
                {preview.errors.slice(0, 20).map((item) => (
                  <li key={`${item.rowNumber}-${item.field}`}>
                    第 {item.rowNumber} 行：{item.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

type ReportData = {
  generatedAt: string;
  metrics: DashboardMetrics;
  rows: SkillMatrixCell[];
};

const percentage = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;

const emptyReportFilters = {
  departmentId: "",
  positionId: "",
  employeeId: "",
  skillId: "",
  status: "",
  validity: "",
  dateFrom: "",
  dateTo: "",
  sortBy: "employeeNumber",
  sortOrder: "asc",
};

export const reportParameters = (values: typeof emptyReportFilters) =>
  new URLSearchParams(
    Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

export function ReportDashboardPanel({
  initialReport,
  initialFilters = emptyReportFilters,
}: {
  initialReport?: ReportData;
  initialFilters?: typeof emptyReportFilters;
} = {}) {
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [options, setOptions] = useState<SkillMatrixCell[]>(initialReport?.rows ?? []);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; report: ReportData }
  >(initialReport ? { status: "ready", report: initialReport } : { status: "loading" });
  const load = async (values = filters, initial = false) => {
    setState({ status: "loading" });
    try {
      const parameters = reportParameters(values);
      const { result } = await request<ReportData>(`/api/reports/dashboard?${parameters}`);
      if (!result.ok) {
        setState({ status: "error", message: result.error.message });
        return;
      }
      if (initial) setOptions(result.data.rows);
      setAppliedFilters(values);
      setState({ status: "ready", report: result.data });
    } catch {
      setState({ status: "error", message: "暂时无法加载管理报表" });
    }
  };
  useEffect(() => {
    if (!initialReport) void load(emptyReportFilters, true);
  }, []);
  if (state.status === "loading")
    return <section className="panel list-state-panel">正在加载 Dashboard 与技能矩阵…</section>;
  if (state.status === "error")
    return (
      <section className="panel list-state-panel" role="alert">
        <p>{state.message}</p>
        <button className="primary-button" type="button" onClick={() => void load()}>
          重新加载
        </button>
      </section>
    );
  const report = state.report;
  const unique = (field: "departmentId" | "positionId" | "employeeId" | "skillId") => [
    ...new Map(options.map((row) => [row[field], row])).values(),
  ];
  const statusLabel = {
    met: "达标",
    gap: "有差距",
    unassessed: "未评定",
    expired: "已过期",
  } as const;
  const validityLabel = {
    effective: "有效",
    expiring_soon: "30 天内到期",
    expired: "已过期",
  } as const;
  const exportUrl = `/api/reports/export.xlsx?${reportParameters(appliedFilters)}`;
  const cards = [
    {
      label: "岗位技能达标率",
      value: percentage(report.metrics.positionSkillCompliance.rate),
      note: `${report.metrics.positionSkillCompliance.numerator} / ${report.metrics.positionSkillCompliance.denominator}`,
      tone: "green",
    },
    {
      label: "部门技能覆盖率",
      value: percentage(report.metrics.departmentSkillCoverage.rate),
      note: `${report.metrics.departmentSkillCoverage.numerator} / ${report.metrics.departmentSkillCoverage.denominator}`,
      tone: "blue",
    },
    {
      label: "培训任务完成率",
      value: percentage(report.metrics.trainingCompletion.rate),
      note: `${report.metrics.trainingCompletion.numerator} / ${report.metrics.trainingCompletion.denominator}`,
      tone: "amber",
    },
    {
      label: "技能到期数量",
      value: String(report.metrics.expiredCount + report.metrics.expiringSoonCount),
      note: `30 天内 ${report.metrics.expiringSoonCount} · 已到期 ${report.metrics.expiredCount}`,
      tone: "red",
    },
  ];
  return (
    <div className="matrix-page">
      <section className="welcome">
        <div>
          <p className="eyebrow">能力风险 Dashboard</p>
          <h1>技能指标与矩阵下钻</h1>
          <p>指标、明细与 Excel 使用同一筛选和计算口径。</p>
        </div>
        <a className="primary-button export-link" href={exportUrl}>
          导出当前 Excel
        </a>
      </section>
      <section className="stat-grid" aria-label="四类核心指标">
        {cards.map((card) => (
          <article className="stat-card" key={card.label}>
            <div className={`metric-icon ${card.tone}`}>
              <TrendingUp size={18} />
            </div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>
      <section className="panel matrix-filter" aria-label="报表筛选">
        <select
          value={filters.departmentId}
          onChange={(event) => setFilters({ ...filters, departmentId: event.target.value })}
        >
          <option value="">全部部门</option>
          {unique("departmentId").map((row) => (
            <option key={row.departmentId} value={row.departmentId}>
              {row.departmentName}
            </option>
          ))}
        </select>
        <select
          value={filters.positionId}
          onChange={(event) => setFilters({ ...filters, positionId: event.target.value })}
        >
          <option value="">全部岗位</option>
          {unique("positionId").map((row) => (
            <option key={row.positionId} value={row.positionId}>
              {row.positionName}
            </option>
          ))}
        </select>
        <select
          value={filters.employeeId}
          onChange={(event) => setFilters({ ...filters, employeeId: event.target.value })}
        >
          <option value="">全部员工</option>
          {unique("employeeId").map((row) => (
            <option key={row.employeeId} value={row.employeeId}>
              {row.employeeNumber} · {row.employeeName}
            </option>
          ))}
        </select>
        <select
          value={filters.skillId}
          onChange={(event) => setFilters({ ...filters, skillId: event.target.value })}
        >
          <option value="">全部技能</option>
          {unique("skillId").map((row) => (
            <option key={row.skillId} value={row.skillId}>
              {row.skillName}
            </option>
          ))}
        </select>
        <select
          value={filters.status}
          onChange={(event) => setFilters({ ...filters, status: event.target.value })}
        >
          <option value="">全部达标状态</option>
          <option value="met">达标</option>
          <option value="gap">有差距</option>
          <option value="unassessed">未评定</option>
          <option value="expired">已过期</option>
        </select>
        <select
          value={filters.validity}
          onChange={(event) => setFilters({ ...filters, validity: event.target.value })}
        >
          <option value="">全部有效期</option>
          <option value="effective">有效</option>
          <option value="expiring_soon">30 天内到期</option>
          <option value="expired">已过期</option>
        </select>
        <input
          aria-label="统计开始日期"
          type="date"
          value={filters.dateFrom}
          onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}
        />
        <input
          aria-label="统计结束日期"
          type="date"
          value={filters.dateTo}
          onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}
        />
        <select
          value={filters.sortBy}
          onChange={(event) => setFilters({ ...filters, sortBy: event.target.value })}
        >
          <option value="employeeNumber">按工号</option>
          <option value="departmentName">按部门</option>
          <option value="positionName">按岗位</option>
          <option value="skillCode">按技能</option>
          <option value="status">按状态</option>
        </select>
        <select
          value={filters.sortOrder}
          onChange={(event) => setFilters({ ...filters, sortOrder: event.target.value })}
        >
          <option value="asc">升序</option>
          <option value="desc">降序</option>
        </select>
        <button className="primary-button" type="button" onClick={() => void load()}>
          应用筛选
        </button>
      </section>
      {report.rows.length === 0 ? (
        <section className="panel list-state">当前筛选暂无技能矩阵数据</section>
      ) : (
        <section className="panel heatmap-panel">
          <div className="heatmap-wrap">
            <table className="heatmap">
              <thead>
                <tr>
                  <th>员工</th>
                  <th>部门 / 岗位</th>
                  <th>技能</th>
                  <th>等级</th>
                  <th>达标</th>
                  <th>有效期</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={`${row.employeeId}:${row.skillId}`}>
                    <td>
                      {row.employeeNumber} · {row.employeeName}
                    </td>
                    <td>
                      {row.departmentName} · {row.positionName}
                    </td>
                    <td>
                      {row.skillCode} · {row.skillName}
                      {row.required ? " · 必备" : ""}
                    </td>
                    <td>
                      {row.currentLevel ?? "—"} / {row.requiredLevel}
                    </td>
                    <td>{statusLabel[row.status]}</td>
                    <td>
                      {row.validityStatus ? validityLabel[row.validityStatus] : "未评定"}
                      {row.validUntil ? ` · ${row.validUntil.slice(0, 10)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="matrix-cards">
            {report.rows.map((row) => (
              <article className="matrix-card" key={`${row.employeeId}:${row.skillId}`}>
                <header>
                  <strong>{row.employeeName}</strong>
                  <span>
                    {row.departmentName} · {row.positionName}
                  </span>
                </header>
                <div className={`matrix-skill heat-${row.status}`}>
                  <span>
                    {row.skillName}
                    {row.required ? " · 必备" : ""}
                  </span>
                  <strong>
                    {row.currentLevel ?? "—"} / {row.requiredLevel} · {statusLabel[row.status]}
                  </strong>
                  <small>
                    {row.validityStatus ? validityLabel[row.validityStatus] : "未评定"}
                    {row.validUntil ? ` · ${row.validUntil.slice(0, 10)}` : ""}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <p className="muted-note">生成时间：{new Date(report.generatedAt).toLocaleString("zh-CN")}</p>
    </div>
  );
}

export const buildSkillMatrixView = (rows: SkillMatrixCell[]) => {
  const employees = [...new Map(rows.map((item) => [item.employeeId, item])).values()];
  const skills = [...new Map(rows.map((item) => [item.skillId, item])).values()];
  const cells = new Map(rows.map((item) => [`${item.employeeId}:${item.skillId}`, item]));
  const summarize = (items: SkillMatrixCell[]) => {
    const target = items.filter((item) => item.required).length;
    const actual = items.filter((item) => item.required && item.status === "met").length;
    return { actual, target, difference: actual - target };
  };
  return {
    employees,
    skills,
    cells,
    employeeSummaries: new Map(
      employees.map((employee) => [
        employee.employeeId,
        summarize(rows.filter((item) => item.employeeId === employee.employeeId)),
      ]),
    ),
    skillSummaries: new Map(
      skills.map((skill) => [
        skill.skillId,
        summarize(rows.filter((item) => item.skillId === skill.skillId)),
      ]),
    ),
  };
};

const formatMatrixDifference = (difference: number) =>
  difference > 0 ? `+${difference}` : String(difference);

function SkillLevelBlocks({ cell }: { cell: SkillMatrixCell }) {
  const currentLevel = cell.currentLevel ?? 0;
  return (
    <div
      className="matrix-level"
      aria-label={`${cell.skillName}：当前 ${cell.currentLevel ?? "未评定"} 级，目标 ${cell.requiredLevel} 级，${
        cell.status === "met" ? "达标" : "未达标"
      }`}
    >
      <div className="matrix-level-blocks" aria-hidden="true">
        {[1, 2, 3, 4].map((level) => (
          <span className={level <= currentLevel ? "filled" : ""} key={level} />
        ))}
      </div>
      <strong>
        现 {cell.currentLevel ?? "—"} · 目 {cell.requiredLevel}
      </strong>
    </div>
  );
}

export function SkillMatrixPanel({
  personal,
  initialRows,
}: {
  personal: boolean;
  initialRows?: SkillMatrixCell[];
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; rows: SkillMatrixCell[] }
  >(initialRows ? { status: "ready", rows: initialRows } : { status: "loading" });
  const [query, setQuery] = useState("");
  const [filterOptions, setFilterOptions] = useState<SkillMatrixCell[]>([]);
  const [filters, setFilters] = useState({
    departmentId: "",
    employeeId: "",
    positionId: "",
    skillId: "",
  });
  const load = async (activeFilters = filters) => {
    setState({ status: "loading" });
    try {
      const parameters = new URLSearchParams(
        Object.entries(activeFilters).filter((entry): entry is [string, string] =>
          Boolean(entry[1]),
        ),
      );
      const { result } = await request<SkillMatrixCell[]>(
        `/api/skill-matrix${parameters.size > 0 ? `?${parameters}` : ""}`,
      );
      if (result.ok && parameters.size === 0) setFilterOptions(result.data);
      setState(
        result.ok
          ? { status: "ready", rows: result.data }
          : { status: "error", message: result.error.message },
      );
    } catch {
      setState({ status: "error", message: "暂时无法加载技能矩阵" });
    }
  };
  useEffect(() => {
    if (!initialRows)
      void load({ departmentId: "", employeeId: "", positionId: "", skillId: "" });
  }, [initialRows]);
  if (state.status === "loading")
    return <section className="panel list-state-panel">正在加载技能矩阵…</section>;
  if (state.status === "error")
    return (
      <section className="panel list-state-panel" role="alert">
        <p>{state.message}</p>
        <button className="primary-button" type="button" onClick={() => void load()}>
          重新加载
        </button>
      </section>
    );
  const rows = state.rows.filter((item) =>
    `${item.employeeNumber} ${item.employeeName} ${item.departmentName} ${item.positionName} ${item.skillName}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const matrix = buildSkillMatrixView(rows);
  const departmentOptions = [
    ...new Map(filterOptions.map((item) => [item.departmentId, item])).values(),
  ];
  const employeeOptions = [
    ...new Map(filterOptions.map((item) => [item.employeeId, item])).values(),
  ];
  const positionOptions = [
    ...new Map(filterOptions.map((item) => [item.positionId, item])).values(),
  ];
  const skillOptions = [...new Map(filterOptions.map((item) => [item.skillId, item])).values()];
  const statusLabel = {
    met: "达标",
    gap: "有差距",
    unassessed: "未评定",
    expired: "已过期",
  } as const;
  const validityLabel = {
    effective: "有效",
    expiring_soon: "30 天内到期",
    expired: "已过期",
  } as const;
  return (
    <div className="matrix-page">
      <section className="welcome">
        <div>
          <p className="eyebrow">{personal ? "我的技能" : "技能矩阵"}</p>
          <h1>{personal ? "岗位技能差距" : "工位技能矩阵表"}</h1>
          <p>
            {personal
              ? "未评定、过期或作废均按不达标处理。"
              : "按员工与技能交叉展示当前等级，并汇总个人及技能达标差异。"}
          </p>
        </div>
      </section>
      <section className="panel matrix-filter">
        {!personal && (
          <>
            <select
              value={filters.departmentId}
              onChange={(event) => setFilters({ ...filters, departmentId: event.target.value })}
            >
              <option value="">全部部门</option>
              {departmentOptions.map((item) => (
                <option key={item.departmentId} value={item.departmentId}>
                  {item.departmentName}
                </option>
              ))}
            </select>
            <select
              value={filters.positionId}
              onChange={(event) => setFilters({ ...filters, positionId: event.target.value })}
            >
              <option value="">全部岗位</option>
              {positionOptions.map((item) => (
                <option key={item.positionId} value={item.positionId}>
                  {item.positionName}
                </option>
              ))}
            </select>
            <select
              value={filters.employeeId}
              onChange={(event) => setFilters({ ...filters, employeeId: event.target.value })}
            >
              <option value="">全部员工</option>
              {employeeOptions.map((item) => (
                <option key={item.employeeId} value={item.employeeId}>
                  {item.employeeNumber} · {item.employeeName}
                </option>
              ))}
            </select>
            <select
              value={filters.skillId}
              onChange={(event) => setFilters({ ...filters, skillId: event.target.value })}
            >
              <option value="">全部技能</option>
              {skillOptions.map((item) => (
                <option key={item.skillId} value={item.skillId}>
                  {item.skillName}
                </option>
              ))}
            </select>
            <button className="primary-button" type="button" onClick={() => void load()}>
              应用筛选
            </button>
          </>
        )}
        <input
          className="table-filter"
          placeholder="筛选员工、岗位或技能"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </section>
      {rows.length === 0 ? (
        <section className="panel list-state">当前范围暂无岗位技能要求</section>
      ) : (
        <section className="panel heatmap-panel">
          <div className="heatmap-wrap">
            <table className="heatmap skill-matrix-grid">
              <thead>
                <tr>
                  <th className="matrix-employee-column">员工 / 岗位</th>
                  {matrix.skills.map((skill) => (
                    <th className="matrix-skill-column" key={skill.skillId}>
                      <strong>{skill.skillName}</strong>
                      <small>{skill.skillCode}</small>
                    </th>
                  ))}
                  <th className="matrix-summary-column">实际达标</th>
                  <th className="matrix-summary-column">目标数</th>
                  <th className="matrix-summary-column">差异</th>
                </tr>
              </thead>
              <tbody>
                {matrix.employees.map((employee) => {
                  const summary = matrix.employeeSummaries.get(employee.employeeId)!;
                  return (
                  <tr key={employee.employeeId}>
                    <th className="matrix-employee-column">
                      <strong>{employee.employeeName}</strong>
                      <small>
                        {employee.employeeNumber} · {employee.positionName}
                      </small>
                    </th>
                    {matrix.skills.map((skill) => {
                      const cell = matrix.cells.get(`${employee.employeeId}:${skill.skillId}`);
                      return (
                        <td className={`heat-${cell?.status ?? "none"}`} key={skill.skillId}>
                          {cell ? (
                            <>
                              <SkillLevelBlocks cell={cell} />
                              <small>
                                {statusLabel[cell.status]} ·{" "}
                                {cell.validityStatus
                                  ? validityLabel[cell.validityStatus]
                                  : "未评定"}{" "}
                                ·{" "}
                                {cell.validUntil
                                  ? `有效至 ${cell.validUntil.slice(0, 10)}`
                                  : "长期有效"}
                                {cell.gap > 0 ? ` · 差 ${cell.gap} 级` : ""}
                              </small>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                    <td className="matrix-summary-value actual">{summary.actual}</td>
                    <td className="matrix-summary-value target">{summary.target}</td>
                    <td className={`matrix-summary-value ${summary.difference < 0 ? "negative" : ""}`}>
                      {formatMatrixDifference(summary.difference)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {(["actual", "target", "difference"] as const).map((metric) => (
                  <tr className="matrix-summary-row" key={metric}>
                    <th>{metric === "actual" ? "实际达标" : metric === "target" ? "目标数" : "差异"}</th>
                    {matrix.skills.map((skill) => {
                      const summary = matrix.skillSummaries.get(skill.skillId)!;
                      const value = summary[metric];
                      return (
                        <td className={metric === "difference" && value < 0 ? "negative" : ""} key={skill.skillId}>
                          {metric === "difference" ? formatMatrixDifference(value) : value}
                        </td>
                      );
                    })}
                    <td className="matrix-summary-spacer" colSpan={3} />
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
          <div className="matrix-cards">
            {matrix.employees.map((employee) => {
              const summary = matrix.employeeSummaries.get(employee.employeeId)!;
              return (
              <article className="matrix-card" key={employee.employeeId}>
                <header>
                  <strong>{employee.employeeName}</strong>
                  <span>{employee.positionName}</span>
                </header>
                <p className="matrix-card-summary">
                  达标 {summary.actual} / {summary.target}
                  <span className={summary.difference < 0 ? "negative" : ""}>
                    差异 {formatMatrixDifference(summary.difference)}
                  </span>
                </p>
                {rows
                  .filter((item) => item.employeeId === employee.employeeId)
                  .map((cell) => (
                    <div className={`matrix-skill heat-${cell.status}`} key={cell.skillId}>
                      <span>
                        {cell.skillName}
                        {cell.required ? " · 必备" : ""}
                      </span>
                      <SkillLevelBlocks cell={cell} />
                      <small>
                        {statusLabel[cell.status]} ·{" "}
                        {cell.validityStatus ? `${validityLabel[cell.validityStatus]} · ` : ""}
                        {cell.validUntil ? `有效至 ${cell.validUntil.slice(0, 10)}` : "长期有效"}
                        {cell.gap > 0 ? ` · 差 ${cell.gap} 级` : ""}
                      </small>
                    </div>
                  ))}
              </article>
              );
            })}
          </div>
          <section className="matrix-level-legend" aria-label="能力等级说明">
            <strong>能力等级说明</strong>
            <div>
              {([0, 1, 2, 3, 4] as const).map((level) => (
                <article key={level}>
                  <span className="legend-level">L{level}</span>
                  <span>{skillLevelMeanings[level]}</span>
                </article>
              ))}
            </div>
          </section>
        </section>
      )}
    </div>
  );
}

const planStatusLabel: Record<TrainingPlanView["status"], string> = {
  draft: "草稿",
  published: "已发布",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};
const taskStatusLabel: Record<TrainingTaskView["status"], string> = {
  assigned: "待学习",
  submitted: "待确认",
  returned: "已退回",
  confirmed: "已确认",
  cancelled: "已取消",
};

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt?: string;
  createdAt: string;
};
type WebhookChannel = { id: string; name: string; maskedUrl: string; active: boolean };
type NotificationDelivery = {
  id: string;
  eventType: string;
  channelName: string;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  lastAttemptAt?: string;
  errorMessage?: string;
};

type AuditRecord = {
  id: string;
  source: "business" | "security";
  actorName?: string;
  action: string;
  objectType: string;
  objectId: string;
  summary: Record<string, unknown>;
  createdAt: string;
};

export function AuditPanel() {
  const [source, setSource] = useState("");
  const [action, setAction] = useState("");
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; rows: AuditRecord[] }
  >({ status: "loading" });
  const load = async () => {
    setState({ status: "loading" });
    try {
      const parameters = new URLSearchParams();
      if (source) parameters.set("source", source);
      if (action.trim()) parameters.set("action", action.trim());
      const { result } = await request<AuditRecord[]>(`/api/admin/audit?${parameters}`);
      setState(
        result.ok
          ? { status: "ready", rows: result.data }
          : { status: "error", message: result.error.message },
      );
    } catch {
      setState({ status: "error", message: "暂时无法加载审计日志" });
    }
  };
  useEffect(() => void load(), []);
  if (state.status === "loading")
    return <section className="panel list-state-panel">正在加载审计日志…</section>;
  if (state.status === "error")
    return (
      <section className="panel list-state-panel" role="alert">
        <p>{state.message}</p>
        <button className="primary-button" type="button" onClick={() => void load()}>
          重新加载
        </button>
      </section>
    );
  return (
    <div className="matrix-page">
      <section className="welcome">
        <div>
          <p className="eyebrow">系统审计</p>
          <h1>关键操作与登录安全事件</h1>
          <p>摘要自动隐藏密码、令牌、密钥和 Webhook 地址。</p>
        </div>
      </section>
      <section className="panel matrix-filter">
        <select value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="">全部来源</option>
          <option value="business">业务操作</option>
          <option value="security">登录安全</option>
        </select>
        <input
          placeholder="按动作筛选"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        />
        <button className="primary-button" type="button" onClick={() => void load()}>
          查询
        </button>
      </section>
      {state.rows.length === 0 ? (
        <section className="panel list-state">当前条件暂无审计记录</section>
      ) : (
        <section className="panel">
          <div className="master-table-wrap">
            <table className="master-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>来源</th>
                  <th>操作者</th>
                  <th>动作</th>
                  <th>对象</th>
                  <th>摘要</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString("zh-CN")}</td>
                    <td>{row.source === "security" ? "登录安全" : "业务操作"}</td>
                    <td>{row.actorName ?? "系统/未知账号"}</td>
                    <td>{row.action}</td>
                    <td>
                      {row.objectType} · {row.objectId}
                    </td>
                    <td>{JSON.stringify(row.summary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="master-cards">
            {state.rows.map((row) => (
              <article className="master-card" key={row.id}>
                <header>
                  <strong>{row.action}</strong>
                  <span>{row.source === "security" ? "登录安全" : "业务操作"}</span>
                </header>
                <p>
                  {row.actorName ?? "系统/未知账号"} ·{" "}
                  {new Date(row.createdAt).toLocaleString("zh-CN")}
                </p>
                <small>
                  {row.objectType} · {row.objectId}
                </small>
                <small>{JSON.stringify(row.summary)}</small>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function NotificationPanel() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; items: NotificationItem[] }
  >({ status: "loading" });
  const load = async () => {
    setState({ status: "loading" });
    try {
      const response = await request<NotificationItem[]>("/api/notifications");
      setState(
        response.result.ok
          ? { status: "ready", items: response.result.data }
          : { status: "error", message: response.result.error.message },
      );
    } catch {
      setState({ status: "error", message: "暂时无法连接通知服务" });
    }
  };
  useEffect(() => {
    void load();
  }, []);
  if (state.status === "loading")
    return <section className="panel list-state-panel">正在加载消息通知…</section>;
  if (state.status === "error")
    return (
      <section className="panel list-state-panel" role="alert">
        <p>{state.message}</p>
        <button className="primary-button" onClick={load} type="button">
          重新加载
        </button>
      </section>
    );
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>消息通知</h2>
          <p>培训、评定与技能到期事项。</p>
        </div>
        <button
          onClick={async () => {
            await request("/api/notifications/read-all", { method: "PATCH" });
            await load();
          }}
          type="button"
        >
          全部标为已读
        </button>
      </div>
      {state.items.length === 0 ? (
        <div className="empty-state">暂无消息通知</div>
      ) : (
        <div className="material-cards">
          {state.items.map((item) => (
            <article key={item.id}>
              <header>
                <strong>{item.title}</strong>
                <span>{item.readAt ? "已读" : "未读"}</span>
              </header>
              <p>{item.message}</p>
              <small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small>
              {!item.readAt && (
                <button
                  onClick={async () => {
                    await request(`/api/notifications/${item.id}/read`, { method: "PATCH" });
                    await load();
                  }}
                  type="button"
                >
                  标为已读
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function WebhookSettingsPanel() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; channels: WebhookChannel[]; deliveries: NotificationDelivery[] }
  >({ status: "loading" });
  const [form, setForm] = useState({ name: "", webhookUrl: "" });
  const [notice, setNotice] = useState("");
  const load = async () => {
    setState({ status: "loading" });
    try {
      const [channels, deliveries] = await Promise.all([
        request<WebhookChannel[]>("/api/admin/webhook-channels"),
        request<NotificationDelivery[]>("/api/admin/notification-deliveries"),
      ]);
      if (!channels.result.ok) {
        setState({ status: "error", message: channels.result.error.message });
        return;
      }
      if (!deliveries.result.ok) {
        setState({ status: "error", message: deliveries.result.error.message });
        return;
      }
      setState({
        status: "ready",
        channels: channels.result.data,
        deliveries: deliveries.result.data,
      });
    } catch {
      setState({ status: "error", message: "暂时无法连接通知配置服务" });
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const mutate = async (path: string, method = "POST", body?: unknown) => {
    const response = await request(path, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    setNotice(response.result.ok ? "操作成功" : response.result.error.message);
    await load();
  };
  if (state.status === "loading")
    return <section className="panel list-state-panel">正在加载 Webhook 配置与发送记录…</section>;
  if (state.status === "error")
    return (
      <section className="panel list-state-panel" role="alert">
        <p>{state.message}</p>
        <button onClick={load} type="button">
          重新加载
        </button>
      </section>
    );
  return (
    <div className="notification-settings-page">
      {notice && (
        <p className="organization-notice" role="status">
          {notice}
        </p>
      )}
      <form
        className="panel compact-form"
        onSubmit={async (event) => {
          event.preventDefault();
          await mutate("/api/admin/webhook-channels", "POST", { ...form, active: true });
          setForm({ name: "", webhookUrl: "" });
        }}
      >
        <h2>企业微信群机器人</h2>
        <input
          required
          placeholder="渠道名称"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <input
          required
          placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
          type="url"
          value={form.webhookUrl}
          onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })}
        />
        <button className="primary-button" type="submit">
          新增 Webhook
        </button>
      </form>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Webhook 渠道</h2>
            <p>完整地址和密钥不会显示在页面或普通日志中。</p>
          </div>
        </div>
        {state.channels.length === 0 ? (
          <div className="empty-state">暂无 Webhook 渠道</div>
        ) : (
          <div className="material-cards">
            {state.channels.map((channel) => (
              <article key={channel.id}>
                <header>
                  <strong>{channel.name}</strong>
                  <span>{channel.active ? "启用" : "停用"}</span>
                </header>
                <p>{channel.maskedUrl}</p>
                <div className="row-actions">
                  <button
                    onClick={() => mutate(`/api/admin/webhook-channels/${channel.id}/test`)}
                    type="button"
                  >
                    测试
                  </button>
                  <button
                    onClick={() =>
                      mutate(`/api/admin/webhook-channels/${channel.id}`, "PATCH", {
                        active: !channel.active,
                      })
                    }
                    type="button"
                  >
                    {channel.active ? "停用" : "启用"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>发送记录</h2>
            <p>展示成功、失败原因、尝试次数和最近尝试时间。</p>
          </div>
        </div>
        {state.deliveries.length === 0 ? (
          <div className="empty-state">暂无发送记录</div>
        ) : (
          <>
            <div className="material-table">
              <table>
                <thead>
                  <tr>
                    <th>事件 / 渠道</th>
                    <th>状态</th>
                    <th>尝试</th>
                    <th>错误</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {state.deliveries.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.eventType}</strong>
                        <small>{item.channelName}</small>
                      </td>
                      <td>{item.status}</td>
                      <td>
                        {item.attempts}
                        <small>
                          {item.lastAttemptAt
                            ? new Date(item.lastAttemptAt).toLocaleString("zh-CN")
                            : "尚未发送"}
                        </small>
                      </td>
                      <td>{item.errorMessage ?? "-"}</td>
                      <td>
                        {item.status === "failed" && (
                          <button
                            onClick={() =>
                              mutate(`/api/admin/notification-deliveries/${item.id}/retry`)
                            }
                            type="button"
                          >
                            重试
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="material-cards">
              {state.deliveries.map((item) => (
                <article key={item.id}>
                  <header>
                    <strong>{item.eventType}</strong>
                    <span>{item.status}</span>
                  </header>
                  <p>
                    {item.channelName} · 已尝试 {item.attempts} 次
                  </p>
                  <small>
                    {item.errorMessage ??
                      (item.lastAttemptAt
                        ? `最近：${new Date(item.lastAttemptAt).toLocaleString("zh-CN")}`
                        : "尚未发送")}
                  </small>
                  {item.status === "failed" && (
                    <button
                      onClick={() => mutate(`/api/admin/notification-deliveries/${item.id}/retry`)}
                      type="button"
                    >
                      重试
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function AssessmentPanel({ session }: { session: Session }) {
  const canAssess = session.role === "hr_admin" || session.role === "department_manager";
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | {
        status: "ready";
        assessments: SkillAssessmentView[];
        employees: Employee[];
        skills: SkillView[];
      }
  >({ status: "loading" });
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<SkillAssessmentView>();
  const [evidence, setEvidence] = useState<File>();
  const [form, setForm] = useState({
    employeeId: "",
    skillId: "",
    method: "practical" as AssessmentMethod,
    level: 2,
    passed: true,
    reason: "",
    remediation: "",
    assessedAt: new Date().toISOString().slice(0, 10),
  });
  const load = async () => {
    setState({ status: "loading" });
    try {
      const [assessments, employees, skills] = await Promise.all([
        request<SkillAssessmentView[]>("/api/assessments"),
        canAssess
          ? request<Employee[]>("/api/organization/employees?active=true")
          : Promise.resolve(undefined),
        canAssess ? request<SkillView[]>("/api/skills") : Promise.resolve(undefined),
      ]);
      const failed = [assessments, employees, skills]
        .filter(Boolean)
        .find((item) => item && !item.result.ok);
      if (failed && !failed.result.ok) {
        setState({ status: "error", message: failed.result.error.message });
        return;
      }
      if (!assessments.result.ok) return;
      setState({
        status: "ready",
        assessments: assessments.result.data,
        employees: employees?.result.ok ? employees.result.data : [],
        skills: skills?.result.ok ? skills.result.data : [],
      });
    } catch {
      setState({ status: "error", message: "暂时无法连接技能评定服务" });
    }
  };
  useEffect(() => {
    void load();
  }, [canAssess]);
  const mutate = async (path: string, body?: unknown, method = "POST") => {
    const response = await request(path, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.result.ok) {
      setNotice(response.result.error.message);
      return false;
    }
    setNotice("操作成功");
    await load();
    return true;
  };
  if (state.status === "loading")
    return <section className="panel list-state-panel">正在加载技能评定…</section>;
  if (state.status === "error")
    return (
      <section className="panel list-state-panel" role="alert">
        <p>{state.message}</p>
        <button className="primary-button" onClick={load} type="button">
          重新加载
        </button>
      </section>
    );
  const beginEdit = (assessment: SkillAssessmentView) => {
    setEditing(assessment);
    setForm({
      employeeId: assessment.employeeId,
      skillId: assessment.skillId,
      method: assessment.method ?? "practical",
      level: assessment.level,
      passed: assessment.passed,
      reason: assessment.reason ?? "",
      remediation: assessment.remediation ?? "",
      assessedAt: assessment.assessedAt.slice(0, 10),
    });
  };
  const actions = (assessment: SkillAssessmentView) => (
    <div className="row-actions">
      <a href={`/api/assessments/${assessment.id}/evidence`}>查看证据</a>
      {canAssess &&
        assessment.assessorEmployeeId === session.employeeId &&
        ["draft", "returned"].includes(assessment.status) && (
          <>
            <button onClick={() => beginEdit(assessment)} type="button">
              修订
            </button>
            <button
              onClick={() => mutate(`/api/assessments/${assessment.id}/submit`)}
              type="button"
            >
              提交主管
            </button>
          </>
        )}
      {session.role === "department_manager" &&
        assessment.assessorEmployeeId !== session.employeeId &&
        assessment.status === "pending_manager" && (
          <>
            <button
              onClick={() => mutate(`/api/assessments/${assessment.id}/manager-confirm`)}
              type="button"
            >
              确认
            </button>
            <button
              onClick={() => {
                const reason = window.prompt("请输入退回原因");
                if (reason) void mutate(`/api/assessments/${assessment.id}/return`, { reason });
              }}
              type="button"
            >
              退回
            </button>
          </>
        )}
      {session.role === "department_manager" &&
        assessment.assessorEmployeeId === session.employeeId &&
        assessment.status === "pending_manager" && <small>本人录入，不能自审</small>}
      {session.role === "hr_admin" && assessment.status === "pending_hr" && (
        <>
          <button onClick={() => mutate(`/api/assessments/${assessment.id}/archive`)} type="button">
            归档生效
          </button>
          <button
            onClick={() => {
              const reason = window.prompt("请输入退回原因");
              if (reason) void mutate(`/api/assessments/${assessment.id}/return`, { reason });
            }}
            type="button"
          >
            退回
          </button>
        </>
      )}
      {session.role === "hr_admin" && assessment.status === "archived" && (
        <button
          onClick={() => {
            const reason = window.prompt("请输入作废原因；纠正后请新建评定");
            if (reason) void mutate(`/api/assessments/${assessment.id}/void`, { reason });
          }}
          type="button"
        >
          作废
        </button>
      )}
    </div>
  );
  return (
    <div className="assessment-page">
      {notice && (
        <p className="organization-notice" role="status">
          {notice}
        </p>
      )}
      {canAssess && (
        <form
          className="panel compact-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const payload = { ...form, assessedAt: new Date(form.assessedAt).toISOString() };
            if (editing) {
              const ok = await mutate(`/api/assessments/${editing.id}`, payload, "PUT");
              if (ok) setEditing(undefined);
              return;
            }
            if (!evidence) {
              setNotice("请选择评定证据");
              return;
            }
            const data = new FormData();
            Object.entries(payload).forEach(([key, value]) => data.set(key, String(value)));
            data.set("file", evidence);
            const response = await request<{ id: string }>("/api/assessments", {
              method: "POST",
              body: data,
            });
            if (!response.result.ok) setNotice(response.result.error.message);
            else {
              setNotice("评定草稿已保存");
              setEvidence(undefined);
              await load();
            }
          }}
        >
          <h2>{editing ? "修订退回评定" : "录入线下技能评定"}</h2>
          <select
            disabled={Boolean(editing)}
            required
            value={form.employeeId}
            onChange={(event) => setForm({ ...form, employeeId: event.target.value })}
          >
            <option value="">选择员工</option>
            {state.employees.map((item) => (
              <option key={item.id} value={item.id}>
                {item.employeeNumber} · {item.displayName}
              </option>
            ))}
          </select>
          <select
            disabled={Boolean(editing)}
            required
            value={form.skillId}
            onChange={(event) => setForm({ ...form, skillId: event.target.value })}
          >
            <option value="">选择技能</option>
            {state.skills
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.name}
                </option>
              ))}
          </select>
          <select
            value={form.method}
            onChange={(event) =>
              setForm({ ...form, method: event.target.value as AssessmentMethod })
            }
          >
            {Object.entries(assessmentMethodLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            max={4}
            min={0}
            type="number"
            value={form.level}
            onChange={(event) => setForm({ ...form, level: Number(event.target.value) })}
          />
          <select
            value={String(form.passed)}
            onChange={(event) => setForm({ ...form, passed: event.target.value === "true" })}
          >
            <option value="true">通过</option>
            <option value="false">未通过</option>
          </select>
          <input
            type="date"
            value={form.assessedAt}
            onChange={(event) => setForm({ ...form, assessedAt: event.target.value })}
          />
          <input
            placeholder={form.passed ? "评定说明（可选）" : "未通过原因（必填）"}
            required={!form.passed}
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
          <input
            placeholder="整改建议"
            value={form.remediation}
            onChange={(event) => setForm({ ...form, remediation: event.target.value })}
          />
          {!editing && (
            <input
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(event) => setEvidence(event.target.files?.[0])}
              required
              type="file"
            />
          )}
          <button className="primary-button" type="submit">
            {editing ? "保存修订" : "保存草稿"}
          </button>
        </form>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{session.role === "employee" ? "我的评定" : "技能评定流转"}</h2>
            <p>至少一名独立人员复核并由 HR 归档后才更新当前技能。</p>
          </div>
        </div>
        {state.assessments.length === 0 ? (
          <div className="empty-state">暂无技能评定</div>
        ) : (
          <>
            <div className="material-table">
              <table>
                <thead>
                  <tr>
                    <th>员工 / 技能</th>
                    <th>结果</th>
                    <th>状态</th>
                    <th>评定日期 / 有效期</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {state.assessments.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.employeeName}</strong>
                        <small>
                          {item.skillCode} · {item.skillName}
                        </small>
                      </td>
                      <td>{item.passed ? `通过 · ${item.level} 级` : `未通过 · ${item.reason}`}</td>
                      <td>{assessmentStatusLabels[item.status]}</td>
                      <td>
                        {item.assessedAt.slice(0, 10)} / {item.validUntil?.slice(0, 10) ?? "长期"}
                      </td>
                      <td>{actions(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="material-cards">
              {state.assessments.map((item) => (
                <article key={item.id}>
                  <header>
                    <strong>
                      {item.employeeName} · {item.skillName}
                    </strong>
                    <span>{assessmentStatusLabels[item.status]}</span>
                  </header>
                  <p>{item.passed ? `通过，等级 ${item.level}` : `未通过：${item.reason}`}</p>
                  {item.remediation && <small>整改建议：{item.remediation}</small>}
                  {actions(item)}
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function TrainingPlanPanel({ session }: { session: Session }) {
  const canManage = session.role === "hr_admin" || session.role === "department_manager";
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | {
        status: "ready";
        plans: TrainingPlanView[];
        tasks: TrainingTaskView[];
        materials: TrainingMaterialView[];
        employees: Employee[];
        departments: Department[];
        positions: Position[];
      }
  >({ status: "loading" });
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [evidence, setEvidence] = useState<File>();
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [form, setForm] = useState({
    title: "",
    materialId: "",
    ownerEmployeeId: "",
    startAt: "",
    dueAt: "",
    location: "",
    scopeType: "department" as TrainingScopeType,
    scopeDepartmentId: "",
    scopePositionId: "",
    scopeEmployeeIds: [] as string[],
  });

  const load = async () => {
    setState({ status: "loading" });
    try {
      const [tasks, plans, materials, employees, departments, positions] = await Promise.all([
        request<TrainingTaskView[]>("/api/training-tasks"),
        canManage ? request<TrainingPlanView[]>("/api/training-plans") : Promise.resolve(undefined),
        canManage
          ? request<TrainingMaterialView[]>("/api/training-materials")
          : Promise.resolve(undefined),
        canManage
          ? request<Employee[]>("/api/organization/employees?active=true")
          : Promise.resolve(undefined),
        canManage
          ? request<Department[]>("/api/organization/departments")
          : Promise.resolve(undefined),
        canManage ? request<Position[]>("/api/organization/positions") : Promise.resolve(undefined),
      ]);
      const responses = [tasks, plans, materials, employees, departments, positions].filter(
        Boolean,
      ) as Array<{ result: ApiResult<unknown> }>;
      const failed = responses.find((item) => !item.result.ok);
      if (failed && !failed.result.ok) {
        setState({ status: "error", message: failed.result.error.message });
        return;
      }
      if (!tasks.result.ok) return;
      setState({
        status: "ready",
        tasks: tasks.result.data,
        plans: plans?.result.ok ? plans.result.data : [],
        materials: materials?.result.ok ? materials.result.data : [],
        employees: employees?.result.ok ? employees.result.data : [],
        departments: departments?.result.ok ? departments.result.data : [],
        positions: positions?.result.ok ? positions.result.data : [],
      });
    } catch {
      setState({ status: "error", message: "暂时无法连接培训计划服务" });
    }
  };
  useEffect(() => {
    void load();
  }, [canManage]);
  const mutate = async (path: string, method = "POST", body?: unknown) => {
    const response = await request(path, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.result.ok) {
      setNotice(response.result.error.message);
      return false;
    }
    setNotice("操作成功");
    await load();
    return true;
  };

  if (state.status === "loading")
    return <section className="panel list-state-panel">正在加载培训计划与任务…</section>;
  if (state.status === "error")
    return (
      <section className="panel list-state-panel" role="alert">
        <p>{state.message}</p>
        <button className="primary-button" onClick={load} type="button">
          重新加载
        </button>
      </section>
    );
  const activeTasks = state.tasks;
  return (
    <div className="training-plan-page">
      {notice && (
        <p className="organization-notice" role="status">
          {notice}
        </p>
      )}
      {canManage && (
        <>
          <form
            className="panel compact-form training-plan-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const payload = {
                ...form,
                ...(form.scopeType === "department"
                  ? { scopeDepartmentId: form.scopeDepartmentId }
                  : { scopeDepartmentId: undefined }),
                ...(form.scopeType === "position"
                  ? { scopePositionId: form.scopePositionId }
                  : { scopePositionId: undefined }),
                ...(form.scopeType === "employees"
                  ? { scopeEmployeeIds: form.scopeEmployeeIds }
                  : { scopeEmployeeIds: undefined }),
              };
              const ok = await mutate(
                editingId ? `/api/training-plans/${editingId}` : "/api/training-plans",
                editingId ? "PATCH" : "POST",
                payload,
              );
              if (ok) {
                setEditingId(undefined);
                setForm({
                  title: "",
                  materialId: "",
                  ownerEmployeeId: "",
                  startAt: "",
                  dueAt: "",
                  location: "",
                  scopeType: "department",
                  scopeDepartmentId: "",
                  scopePositionId: "",
                  scopeEmployeeIds: [],
                });
              }
            }}
          >
            <h2>{editingId ? "编辑培训草稿" : "新建培训计划"}</h2>
            <input
              required
              placeholder="计划名称"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
            <select
              required
              value={form.materialId}
              onChange={(event) => setForm({ ...form, materialId: event.target.value })}
            >
              <option value="">选择培训资料</option>
              {state.materials
                .filter((item) => item.active)
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
            <select
              required
              value={form.ownerEmployeeId}
              onChange={(event) => setForm({ ...form, ownerEmployeeId: event.target.value })}
            >
              <option value="">选择负责人</option>
              {state.employees
                .filter((item) => item.active)
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.displayName}
                  </option>
                ))}
            </select>
            <input
              required
              type="datetime-local"
              value={form.startAt}
              onChange={(event) => setForm({ ...form, startAt: event.target.value })}
            />
            <input
              required
              type="datetime-local"
              value={form.dueAt}
              onChange={(event) => setForm({ ...form, dueAt: event.target.value })}
            />
            <input
              required
              placeholder="地点"
              value={form.location}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
            />
            <select
              value={form.scopeType}
              onChange={(event) =>
                setForm({ ...form, scopeType: event.target.value as TrainingScopeType })
              }
            >
              <option value="department">按部门</option>
              <option value="position">按岗位</option>
              <option value="employees">指定员工</option>
            </select>
            {form.scopeType === "department" && (
              <select
                required
                value={form.scopeDepartmentId}
                onChange={(event) => setForm({ ...form, scopeDepartmentId: event.target.value })}
              >
                <option value="">选择部门</option>
                {state.departments
                  .filter((item) => item.active)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            )}
            {form.scopeType === "position" && (
              <select
                required
                value={form.scopePositionId}
                onChange={(event) => setForm({ ...form, scopePositionId: event.target.value })}
              >
                <option value="">选择岗位</option>
                {state.positions
                  .filter((item) => item.active)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            )}
            {form.scopeType === "employees" && (
              <select
                multiple
                required
                value={form.scopeEmployeeIds}
                onChange={(event) =>
                  setForm({
                    ...form,
                    scopeEmployeeIds: Array.from(event.target.options)
                      .filter((item) => item.selected)
                      .map((item) => item.value),
                  })
                }
              >
                {state.employees
                  .filter((item) => item.active)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.displayName}
                    </option>
                  ))}
              </select>
            )}
            <button className="primary-button" type="submit">
              保存草稿
            </button>
          </form>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>培训计划</h2>
                <p>发布后固化对象并生成员工任务。</p>
              </div>
            </div>
            {state.plans.length === 0 ? (
              <div className="list-state-panel">暂无培训计划</div>
            ) : (
              <div className="material-table">
                <table>
                  <thead>
                    <tr>
                      <th>计划</th>
                      <th>负责人/时间</th>
                      <th>进度</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.plans.map((plan) => (
                      <tr key={plan.id}>
                        <td>
                          <strong>{plan.title}</strong>
                          <small>{plan.materialTitle}</small>
                        </td>
                        <td>
                          {plan.ownerName}
                          <small>
                            {new Date(plan.startAt).toLocaleString()} —{" "}
                            {new Date(plan.dueAt).toLocaleString()}
                          </small>
                        </td>
                        <td>
                          {plan.confirmedCount}/{plan.taskCount}
                        </td>
                        <td>{planStatusLabel[plan.status]}</td>
                        <td>
                          {plan.status === "draft" && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(plan.id);
                                  setForm({
                                    title: plan.title,
                                    materialId: plan.materialId,
                                    ownerEmployeeId: plan.ownerEmployeeId,
                                    startAt: plan.startAt.slice(0, 16),
                                    dueAt: plan.dueAt.slice(0, 16),
                                    location: plan.location,
                                    scopeType: plan.scopeType,
                                    scopeDepartmentId: plan.scopeDepartmentId ?? "",
                                    scopePositionId: plan.scopePositionId ?? "",
                                    scopeEmployeeIds: plan.scopeEmployeeIds,
                                  });
                                }}
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void mutate(`/api/training-plans/${plan.id}/publish`)
                                }
                              >
                                发布
                              </button>
                            </>
                          )}
                          {["draft", "published", "in_progress"].includes(plan.status) && (
                            <button
                              type="button"
                              onClick={() => void mutate(`/api/training-plans/${plan.id}/cancel`)}
                            >
                              取消
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{canManage ? "培训任务与待办" : "我的培训"}</h2>
            <p>员工提交后，负责人或部门主管确认才进入正式履历。</p>
          </div>
        </div>
        {activeTasks.length === 0 ? (
          <div className="list-state-panel">暂无培训任务</div>
        ) : (
          <>
            <div className="material-table">
              <table>
                <thead>
                  <tr>
                    {canManage && <th>选择</th>}
                    <th>计划/员工</th>
                    <th>截止时间</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTasks.map((task) => (
                    <tr key={task.id}>
                      {canManage && (
                        <td>
                          <input
                            type="checkbox"
                            disabled={
                              task.status === "confirmed" || task.employeeId === session.employeeId
                            }
                            checked={selectedTasks.includes(task.id)}
                            onChange={(event) =>
                              setSelectedTasks(
                                event.target.checked
                                  ? [...selectedTasks, task.id]
                                  : selectedTasks.filter((id) => id !== task.id),
                              )
                            }
                          />
                        </td>
                      )}
                      <td>
                        <strong>{task.planTitle}</strong>
                        <small>
                          {canManage
                            ? `${task.employeeNumber} · ${task.employeeName}`
                            : task.materialTitle}
                        </small>
                      </td>
                      <td>
                        {new Date(task.dueAt).toLocaleString()}
                        {task.overdue && <small> · 已逾期</small>}
                      </td>
                      <td>
                        {taskStatusLabel[task.status]}
                        {task.returnReason && <small> · {task.returnReason}</small>}
                      </td>
                      <td>
                        {task.evidence.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() =>
                              window.open(
                                `/api/training-evidence/${item.id}/content`,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            查看证据
                          </button>
                        ))}
                        {task.employeeId === session.employeeId && (
                          <button
                            type="button"
                            onClick={() =>
                              window.open(
                                `/api/training-materials/${task.materialId}/content`,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            查看资料
                          </button>
                        )}
                        {task.employeeId === session.employeeId &&
                          ["assigned", "returned"].includes(task.status) && (
                            <>
                              <button
                                type="button"
                                onClick={() => void mutate(`/api/training-tasks/${task.id}/submit`)}
                              >
                                提交完成
                              </button>
                            </>
                          )}
                        {canManage &&
                          task.employeeId !== session.employeeId &&
                          task.status === "submitted" && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  void mutate(`/api/training-tasks/${task.id}/confirm`)
                                }
                              >
                                确认
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const reason = window.prompt("请输入退回原因");
                                  if (reason)
                                    void mutate(`/api/training-tasks/${task.id}/return`, "POST", {
                                      reason,
                                    });
                                }}
                              >
                                退回
                              </button>
                            </>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="material-cards">
              {activeTasks.map((task) => (
                <article key={task.id}>
                  <header>
                    <strong>{task.planTitle}</strong>
                    <span>{taskStatusLabel[task.status]}</span>
                  </header>
                  <p>
                    {canManage ? task.employeeName : task.materialTitle} ·{" "}
                    {new Date(task.dueAt).toLocaleString()}
                  </p>
                  {task.evidence.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        window.open(
                          `/api/training-evidence/${item.id}/content`,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      查看签到证据
                    </button>
                  ))}
                  {task.employeeId === session.employeeId && (
                    <button
                      type="button"
                      onClick={() =>
                        window.open(
                          `/api/training-materials/${task.materialId}/content`,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      查看培训资料
                    </button>
                  )}
                  {task.employeeId === session.employeeId &&
                    ["assigned", "returned"].includes(task.status) && (
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void mutate(`/api/training-tasks/${task.id}/submit`)}
                      >
                        提交完成
                      </button>
                    )}
                </article>
              ))}
            </div>
          </>
        )}
        {canManage && (
          <form
            className="batch-confirm"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!evidence || selectedTasks.length === 0) {
                setNotice("请选择参训任务并上传签到表或照片");
                return;
              }
              const planId = state.tasks.find((task) => selectedTasks.includes(task.id))?.planId;
              if (
                !planId ||
                selectedTasks.some(
                  (id) => state.tasks.find((task) => task.id === id)?.planId !== planId,
                )
              ) {
                setNotice("批量确认必须选择同一计划的任务");
                return;
              }
              const body = new FormData();
              body.set("taskIds", JSON.stringify(selectedTasks));
              body.set("file", evidence);
              const response = await request(`/api/training-plans/${planId}/batch-confirm`, {
                method: "POST",
                body,
              });
              setNotice(response.result.ok ? "批量确认成功" : response.result.error.message);
              if (response.result.ok) {
                setSelectedTasks([]);
                setEvidence(undefined);
                await load();
              }
            }}
          >
            <input
              type="file"
              required
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(event) => setEvidence(event.target.files?.[0])}
            />
            <button className="primary-button" type="submit">
              上传证据并批量确认
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

export function TrainingMaterialPanel({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; materials: TrainingMaterialView[]; skills: SkillView[] }
  >({ status: "loading" });
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    title: "",
    category: "",
    description: "",
    externalUrl: "",
    skillIds: [] as string[],
  });
  const [file, setFile] = useState<File>();

  const load = async () => {
    setState({ status: "loading" });
    try {
      const materials = await request<TrainingMaterialView[]>(
        `/api/training-materials${canManage ? "?includeInactive=true" : ""}`,
      );
      if (!materials.result.ok) {
        setState({ status: "error", message: materials.result.error.message });
        return;
      }
      let skills: SkillView[] = [];
      if (canManage) {
        const response = await request<SkillView[]>("/api/skills");
        if (!response.result.ok) {
          setState({ status: "error", message: response.result.error.message });
          return;
        }
        skills = response.result.data;
      }
      setState({ status: "ready", materials: materials.result.data, skills });
    } catch {
      setState({ status: "error", message: "暂时无法连接培训资料服务" });
    }
  };
  useEffect(() => {
    void load();
  }, [canManage]);

  const create = async (event: FormEvent, kind: "file" | "link") => {
    event.preventDefault();
    setNotice("");
    let response: { result: ApiResult<{ id: string }> };
    if (kind === "file") {
      if (!file) {
        setNotice("请选择文件");
        return;
      }
      const body = new FormData();
      body.set("title", form.title);
      body.set("category", form.category);
      body.set("description", form.description);
      body.set("skillIds", JSON.stringify(form.skillIds));
      body.set("file", file);
      response = await request("/api/training-materials/upload", { method: "POST", body });
    } else {
      response = await request("/api/training-materials/link", {
        method: "POST",
        body: JSON.stringify(form),
      });
    }
    if (!response.result.ok) {
      setNotice(response.result.error.message);
      return;
    }
    setNotice("资料保存成功");
    setForm({ title: "", category: "", description: "", externalUrl: "", skillIds: [] });
    setFile(undefined);
    await load();
  };
  const changeSkills = (values: HTMLOptionsCollection) =>
    setForm({
      ...form,
      skillIds: Array.from(values)
        .filter((item) => item.selected)
        .map((item) => item.value),
    });
  const openContent = async (material: TrainingMaterialView) => {
    setNotice("");
    if (material.kind === "link") {
      const opened = window.open(
        `/api/training-materials/${material.id}/content`,
        "_blank",
        "noopener,noreferrer",
      );
      if (!opened) setNotice("浏览器阻止了新窗口，请允许弹窗后重试");
      return;
    }
    try {
      const response = await fetch(`/api/training-materials/${material.id}/content`, {
        credentials: "include",
      });
      if (!response.ok) {
        const result = (await response.json()) as ApiResult<never>;
        setNotice(result.ok ? "下载失败" : result.error.message);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = material.originalFilename ?? material.title;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotice("下载失败，请稍后重试");
    }
  };

  if (state.status === "loading")
    return <section className="panel list-state-panel">正在加载培训资料…</section>;
  if (state.status === "error")
    return (
      <section className="panel list-state-panel" role="alert">
        <p>{state.message}</p>
        <button className="primary-button" onClick={load} type="button">
          重新加载
        </button>
      </section>
    );
  const materials = state.materials.filter((item) =>
    `${item.title} ${item.category} ${item.skills.map((skill) => skill.name).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="material-page">
      <section className="welcome">
        <div>
          <p className="eyebrow">培训资料</p>
          <h1>{canManage ? "培训资料库" : "学习资料"}</h1>
          <p>查找与岗位技能关联的文档、图片和外部课程。</p>
        </div>
      </section>
      {notice && (
        <p className="organization-notice" role="status">
          {notice}
        </p>
      )}
      {canManage && (
        <form
          className="panel compact-form material-form"
          onSubmit={(event) => void create(event, file ? "file" : "link")}
        >
          <h2>新增资料</h2>
          <input
            required
            maxLength={150}
            placeholder="资料标题"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
          <input
            required
            maxLength={80}
            placeholder="分类，如：安全培训"
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
          />
          <textarea
            maxLength={500}
            placeholder="资料说明（选填）"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
          <select
            multiple
            required
            aria-label="关联技能"
            value={form.skillIds}
            onChange={(event) => changeSkills(event.target.options)}
          >
            {state.skills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.code} · {skill.name}
              </option>
            ))}
          </select>
          <input
            type="url"
            placeholder="外部网页或视频链接（与文件二选一）"
            value={form.externalUrl}
            onChange={(event) => setForm({ ...form, externalUrl: event.target.value })}
            disabled={Boolean(file)}
          />
          <input
            type="file"
            accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.webp"
            onChange={(event) => setFile(event.target.files?.[0])}
            disabled={Boolean(form.externalUrl)}
          />
          <button className="primary-button" type="submit">
            保存资料
          </button>
        </form>
      )}
      <section className="panel material-list">
        <div className="panel-heading">
          <div>
            <h2>资料列表</h2>
            <p>停用资料不会出现在新的员工学习入口。</p>
          </div>
          <input
            aria-label="搜索资料"
            placeholder="搜索标题、分类或技能"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {materials.length === 0 ? (
          <div className="list-state-panel">暂无符合条件的培训资料</div>
        ) : (
          <>
            <div className="material-table">
              <table>
                <thead>
                  <tr>
                    <th>资料</th>
                    <th>分类</th>
                    <th>关联技能</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map((material) => (
                    <tr key={material.id}>
                      <td>
                        <strong>{material.title}</strong>
                        <small>
                          {material.kind === "file" ? material.originalFilename : "外部链接"}
                        </small>
                      </td>
                      <td>{material.category}</td>
                      <td>{material.skills.map((skill) => skill.name).join("、")}</td>
                      <td>{material.active ? "可用" : "已停用"}</td>
                      <td>
                        <button type="button" onClick={() => void openContent(material)}>
                          查看/下载
                        </button>
                        {canManage && material.active && (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                const title = window.prompt("资料标题", material.title);
                                if (!title) return;
                                const category = window.prompt("资料分类", material.category);
                                if (!category) return;
                                const result = await request(
                                  `/api/training-materials/${material.id}`,
                                  {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                      title,
                                      category,
                                      description: material.description,
                                      skillIds: material.skillIds,
                                    }),
                                  },
                                );
                                setNotice(
                                  result.result.ok ? "资料已更新" : result.result.error.message,
                                );
                                await load();
                              }}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const result = await request(
                                  `/api/training-materials/${material.id}/deactivate`,
                                  { method: "POST" },
                                );
                                setNotice(
                                  result.result.ok ? "资料已停用" : result.result.error.message,
                                );
                                await load();
                              }}
                            >
                              停用
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="material-cards">
              {materials.map((material) => (
                <article key={material.id}>
                  <header>
                    <strong>{material.title}</strong>
                    <span>{material.active ? "可用" : "已停用"}</span>
                  </header>
                  <p>
                    {material.category} · {material.skills.map((skill) => skill.name).join("、")}
                  </p>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void openContent(material)}
                  >
                    查看/下载
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Dashboard({ onLoggedOut, session }: { onLoggedOut: () => void; session: Session }) {
  const navigation = navigationForRole(session.role);
  const [activeNavigation, setActiveNavigation] = useState(navigation[0]?.id ?? "dashboard");
  const statistics = statisticsForRole(session.role);
  const isManagement = ["department_manager", "hr_admin", "executive_viewer"].includes(
    session.role,
  );

  const logout = async () => {
    await request("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    onLoggedOut();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Factory size={22} strokeWidth={2.2} />
          </span>
          <span>
            <strong>技能矩阵</strong>
            <small>工厂人才管理</small>
          </span>
        </div>
        <nav aria-label="主导航">
          <p className="nav-caption">我的菜单</p>
          {navigation.map((item) => (
            <NavigationButton
              active={activeNavigation === item.id}
              item={item}
              key={item.id}
              onSelect={() => setActiveNavigation(item.id)}
            />
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item" onClick={logout} type="button">
            <LogIn className="logout-icon" size={19} />
            <span>退出登录</span>
          </button>
          <div className="factory-chip">
            <span>当前组织</span>
            <strong>示范制造工厂</strong>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="search">
            <Search size={18} />
            <span>搜索员工、岗位或技能</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="account">
            <button
              className="icon-button mobile-logout"
              onClick={logout}
              type="button"
              aria-label="退出登录"
            >
              <LogIn className="logout-icon" size={19} />
            </button>
            <button className="icon-button" type="button" aria-label="通知">
              <Bell size={19} />
              <i />
            </button>
            <span className="avatar">{session.displayName.slice(0, 1)}</span>
            <span className="account-name">
              <strong>{session.displayName}</strong>
              <small>
                {session.employeeNumber} · {roleLabel[session.role]}
              </small>
            </span>
            <ChevronRight size={16} />
          </div>
        </header>

        <div className="content">
          {activeNavigation === "organization" ||
          activeNavigation === "employees" ||
          activeNavigation === "profile" ? (
            <OrganizationPanel canManage={session.role === "hr_admin"} />
          ) : activeNavigation === "skills" ? (
            <SkillAdminPanel />
          ) : activeNavigation === "matrix" || activeNavigation === "reports" ? (
            <ReportDashboardPanel />
          ) : activeNavigation === "my-skills" ? (
            <SkillMatrixPanel personal />
          ) : activeNavigation === "training" || activeNavigation === "my-training" ? (
            <div className="training-workspace">
              <TrainingPlanPanel session={session} />
              <TrainingMaterialPanel canManage={session.role === "hr_admin"} />
            </div>
          ) : activeNavigation === "assessments" || activeNavigation === "my-assessments" ? (
            <AssessmentPanel session={session} />
          ) : activeNavigation === "notifications" ? (
            <NotificationPanel />
          ) : activeNavigation === "audit" ? (
            <AuditPanel />
          ) : activeNavigation === "settings" ? (
            <WebhookSettingsPanel />
          ) : activeNavigation === "dashboard" && isManagement ? (
            <ReportDashboardPanel />
          ) : (
            <>
              <section className="welcome">
                <div>
                  <p className="eyebrow">技能与培训工作空间</p>
                  <h1>早上好，{session.displayName}</h1>
                  <p>
                    {session.role === "employee"
                      ? "查看你的培训安排、技能差距和最新评定。"
                      : "这里是你当前权限范围内的工厂技能概况。"}
                  </p>
                </div>
                {session.role !== "executive_viewer" && (
                  <button className="primary-button" type="button">
                    <ClipboardCheck size={18} />
                    查看待办
                  </button>
                )}
              </section>

              <section className="stat-grid" aria-label="关键指标">
                {statistics.map((item) => (
                  <article className="stat-card" key={item.label}>
                    <div className={`metric-icon ${item.tone}`}>
                      <TrendingUp size={18} />
                    </div>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.note}</small>
                  </article>
                ))}
              </section>

              {isManagement ? (
                <div className="dashboard-grid">
                  <section className="panel matrix-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>部门技能达标概况</h2>
                        <p>按部门查看当前在岗员工达标情况</p>
                      </div>
                      <button type="button">
                        查看完整矩阵 <ChevronRight size={16} />
                      </button>
                    </div>
                    <div className="department-list">
                      {departments.map((department) => (
                        <div className="department-row" key={department.name}>
                          <span className="department-icon">
                            <Factory size={18} />
                          </span>
                          <div className="department-copy">
                            <div>
                              <strong>{department.name}</strong>
                              <small>{department.people} 人</small>
                              <b>{department.rate}%</b>
                            </div>
                            <div className="progress">
                              <i
                                style={{
                                  width: `${department.rate}%`,
                                  background: department.color,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <TodoPanel mode={session.role === "executive_viewer" ? "viewer" : "management"} />
                </div>
              ) : session.role === "employee" ? (
                <div className="dashboard-grid">
                  <section className="panel matrix-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>我的技能差距</h2>
                        <p>当前岗位要求与有效能力等级</p>
                      </div>
                      <button type="button">
                        查看技能档案 <ChevronRight size={16} />
                      </button>
                    </div>
                    <div className="skill-gap">
                      <strong>岗位达标 8 / 12</strong>
                      <div className="progress">
                        <i style={{ width: "67%", background: "var(--green)" }} />
                      </div>
                      <p>建议优先完成“设备点检规范”培训，并申请焊接操作复评。</p>
                    </div>
                  </section>
                  <TodoPanel mode="employee" />
                </div>
              ) : (
                <div className="dashboard-grid">
                  <AdminResetPanel />
                  <TodoPanel mode="system" />
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

const todoContent = {
  management: {
    title: "我的待办",
    subtitle: "需要你处理的工厂管理事项",
    items: [
      ["技能评定待确认", "王强等 4 人提交了评定"],
      ["培训任务提醒", "2 项线下培训即将到期"],
      ["档案完整性", "1 名员工缺少岗位信息"],
    ],
  },
  viewer: {
    title: "关注事项",
    subtitle: "只读查看当前经营风险",
    items: [
      ["关键岗位缺口", "3 个岗位存在技能覆盖风险"],
      ["培训完成趋势", "本月完成率较上月提升"],
      ["证书到期提醒", "未来 30 天有 6 项到期"],
    ],
  },
  employee: {
    title: "我的待办",
    subtitle: "只展示与你本人有关的培训与技能事项",
    items: [
      ["待完成培训", "设备点检规范 · 本周五前完成"],
      ["评定结果已更新", "焊接操作技能已完成复评"],
      ["技能到期提醒", "安全作业证将在 30 天后到期"],
    ],
  },
  system: {
    title: "安全待办",
    subtitle: "账号与访问安全事项",
    items: [
      ["首次登录账号", "2 个账号仍需修改初始密码"],
      ["临时锁定", "查看近期登录失败与锁定记录"],
      ["安全审计", "密码重置与越权拒绝均已留痕"],
    ],
  },
} as const;

function TodoPanel({ mode }: { mode: keyof typeof todoContent }) {
  const content = todoContent[mode];
  return (
    <section className="panel todo-panel">
      <div className="panel-heading">
        <div>
          <h2>{content.title}</h2>
          <p>{content.subtitle}</p>
        </div>
        <span className="count-pill">3</span>
      </div>
      <div className="todo-list">
        {content.items.map(([title, detail], index) => (
          <button type="button" key={title}>
            <span className={`todo-icon ${["amber", "blue", "green"][index]}`}>
              {index === 0 ? (
                <ClipboardCheck size={19} />
              ) : index === 1 ? (
                <GraduationCap size={19} />
              ) : (
                <UserRound size={19} />
              )}
            </span>
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
    </section>
  );
}

export function App({ initialSession }: { initialSession?: Session }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "anonymous" } | { status: "authenticated"; session: Session }
  >(initialSession ? { status: "authenticated", session: initialSession } : { status: "loading" });

  useEffect(() => {
    if (initialSession) return;
    void request<Session>("/api/auth/session")
      .then(({ result }) => {
        setState(
          result.ok ? { status: "authenticated", session: result.data } : { status: "anonymous" },
        );
      })
      .catch(() => setState({ status: "anonymous" }));
  }, [initialSession]);

  if (state.status === "loading") {
    return (
      <main className="loading-page">
        <Factory size={28} />
        <span>正在进入技能矩阵…</span>
      </main>
    );
  }
  if (state.status === "anonymous") {
    return <LoginPage onLoggedIn={(session) => setState({ status: "authenticated", session })} />;
  }
  if (state.session.mustChangePassword) {
    return (
      <PasswordChangePage
        onChanged={(session) => setState({ status: "authenticated", session })}
        onLoggedOut={() => setState({ status: "anonymous" })}
        session={state.session}
      />
    );
  }
  return (
    <Dashboard onLoggedOut={() => setState({ status: "anonymous" })} session={state.session} />
  );
}
