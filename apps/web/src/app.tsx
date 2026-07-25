import {
  Bell,
  BookOpenCheck,
  ChevronRight,
  ClipboardCheck,
  Factory,
  GraduationCap,
  LayoutDashboard,
  Search,
  Settings,
  TrendingUp,
  UserRound,
  UsersRound,
} from "lucide-react";

const navigation = [
  { label: "工作台", icon: LayoutDashboard, active: true },
  { label: "员工档案", icon: UsersRound },
  { label: "技能标准", icon: BookOpenCheck },
  { label: "评定管理", icon: ClipboardCheck, badge: "6" },
  { label: "培训任务", icon: GraduationCap },
];

const statistics = [
  { label: "在岗员工", value: "286", note: "本月新增 8 人", tone: "green" },
  { label: "技能达标率", value: "82.6%", note: "较上月 +3.2%", tone: "amber" },
  { label: "待确认评定", value: "6", note: "其中 2 项即将超期", tone: "red" },
  { label: "培训完成率", value: "91.4%", note: "本月任务 128 项", tone: "blue" },
];

const departments = [
  { name: "装配一部", people: 68, rate: 91, color: "var(--green)" },
  { name: "机加车间", people: 54, rate: 84, color: "var(--amber)" },
  { name: "质量部", people: 32, rate: 79, color: "var(--blue)" },
  { name: "装配二部", people: 71, rate: 73, color: "var(--coral)" },
];

export function App() {
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
          <p className="nav-caption">管理菜单</p>
          {navigation.map(({ label, icon: Icon, active, badge }) => (
            <button
              aria-label={label}
              className={`nav-item${active ? " active" : ""}`}
              key={label}
              type="button"
            >
              <Icon size={19} />
              <span>{label}</span>
              {badge && <em>{badge}</em>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button className="nav-item" type="button">
            <Settings size={19} />
            <span>系统设置</span>
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
            <button className="icon-button" type="button" aria-label="通知">
              <Bell size={19} />
              <i />
            </button>
            <span className="avatar">张</span>
            <span className="account-name">
              <strong>张明</strong>
              <small>生产一部 · 部门主管</small>
            </span>
            <ChevronRight size={16} />
          </div>
        </header>

        <div className="content">
          <section className="welcome">
            <div>
              <p className="eyebrow">2026年7月25日 · 星期六</p>
              <h1>早上好，张明</h1>
              <p>
                这里是工厂技能概况。今天有 <strong>6 项评定</strong>等待你确认。
              </p>
            </div>
            <button className="primary-button" type="button">
              <ClipboardCheck size={18} />
              处理待办
            </button>
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
                        <i style={{ width: `${department.rate}%`, background: department.color }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel todo-panel">
              <div className="panel-heading">
                <div>
                  <h2>我的待办</h2>
                  <p>需要你处理的工作</p>
                </div>
                <span className="count-pill">6</span>
              </div>
              <div className="todo-list">
                <button type="button">
                  <span className="todo-icon amber">
                    <ClipboardCheck size={19} />
                  </span>
                  <span>
                    <strong>技能评定待确认</strong>
                    <small>王强等 4 人提交了评定</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
                <button type="button">
                  <span className="todo-icon blue">
                    <GraduationCap size={19} />
                  </span>
                  <span>
                    <strong>培训结果待审核</strong>
                    <small>2 项线下培训已完成</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
                <button type="button">
                  <span className="todo-icon green">
                    <UserRound size={19} />
                  </span>
                  <span>
                    <strong>员工档案待完善</strong>
                    <small>新员工李华缺少岗位信息</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
