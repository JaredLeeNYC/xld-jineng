import {
  navigationForRole,
  type FixedRole,
  type NavigationItem,
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

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

const request = async <T,>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; result: ApiResult<T> }> => {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
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
  "my-skills": BookOpenCheck,
  "my-training": GraduationCap,
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
        <p className="auth-help">新密码至少 12 位。完成修改前不能进入业务页面。</p>
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
            minLength={12}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            type="password"
          />
        </label>
        <label>
          <span>再次输入新密码</span>
          <input
            autoComplete="new-password"
            minLength={12}
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

function NavigationButton({ item }: { item: NavigationItem }) {
  const Icon = iconByNavigation[item.id] ?? LayoutDashboard;
  return (
    <button
      aria-label={item.label}
      className={`nav-item${item === navigationForRole("employee")[0] || item.id === "dashboard" || item.id === "accounts" ? " active" : ""}`}
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
            minLength={12}
            maxLength={200}
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

function Dashboard({ onLoggedOut, session }: { onLoggedOut: () => void; session: Session }) {
  const navigation = navigationForRole(session.role);
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
            <NavigationButton item={item} key={item.id} />
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
                            style={{ width: `${department.rate}%`, background: department.color }}
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
