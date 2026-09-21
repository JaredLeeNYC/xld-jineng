import { useEffect, useState } from "react";
import { MaterialPreviewButton } from "./material-preview";
import {
  trainingTypes,
  trainingTypeLabels,
  type TrainingPlanView,
  type TrainingTaskView,
  type TrainingType,
  type TrainingScopeType,
} from "@jineng/skill-matrix-shared";

type Session = { role: string; accountId: string; employeeId: string };
type Option = {
  id: string;
  name?: string;
  title?: string;
  displayName?: string;
  employeeNumber?: string;
  active?: boolean;
  role?: string;
  departmentId?: string;
  positionId?: string;
};
const request = async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
  const response = await fetch(path, {
    method,
    credentials: "include",
    ...(body
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error?.message ?? "操作失败");
  return result.data as T;
};
const planLabels: Record<string, string> = {
  draft: "草稿",
  pending_approval: "待审批",
  published: "待开始",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};
const taskLabels: Record<string, string> = {
  assigned: "待开始",
  in_progress: "进行中",
  confirmed: "已完成",
  submitted: "历史待确认",
  returned: "历史已退回",
  cancelled: "已取消",
};
const date = (value?: string) =>
  value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";
const emptyForm = () => ({
  title: "",
  trainingType: "professional" as TrainingType,
  materialIds: [] as string[],
  ownerEmployeeIds: [] as string[],
  startAt: "",
  dueAt: "",
  historicalCompleted: false,
  location: "",
  scopeType: "department" as TrainingScopeType,
  scopeDepartmentIds: [] as string[],
  scopePositionIds: [] as string[],
  scopeEmployeeIds: [] as string[],
});
function MultiSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: Option[];
  onChange: (value: string[]) => void;
}) {
  return (
    <fieldset>
      <legend>{label}（可多选）</legend>
      <div style={{ maxHeight: 150, overflow: "auto", display: "flex", flexWrap: "wrap", gap: 12 }}>
        {options
          .filter((o) => o.active !== false)
          .map((o) => (
            <label key={o.id}>
              <input
                type="checkbox"
                checked={value.includes(o.id)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...value, o.id] : value.filter((id) => id !== o.id))
                }
              />
              {o.name ?? o.title ?? o.displayName}
              {o.employeeNumber ? `（${o.employeeNumber}）` : ""}
            </label>
          ))}
      </div>
    </fieldset>
  );
}
const emptyListFilters = {
  department: "",
  position: "",
  employee: "",
  owner: "",
  from: "",
  to: "",
  status: "",
  type: "",
  progress: "",
};
type ListFilters = typeof emptyListFilters;
function ListFilterBar({
  value,
  onChange,
  departments = [],
  positions = [],
  employees = [],
  statuses = {},
  training = false,
}: {
  value: ListFilters;
  onChange: (value: ListFilters) => void;
  departments?: Array<{ id: string; name: string }>;
  positions?: Array<{ id: string; name: string }>;
  employees?: Array<{ id: string; name: string }>;
  statuses?: Record<string, string>;
  training?: boolean;
}) {
  const select = (
    key: keyof ListFilters,
    label: string,
    options: Array<{ id: string; name: string }>,
  ) => (
    <label key={key}>
      {label}
      <select
        aria-label={label + "筛选"}
        value={value[key]}
        onChange={(event) =>
          onChange({
            ...value,
            [key]: event.target.value,
            ...(key === "department" ? { position: "" } : {}),
          })
        }
      >
        <option value="">全部</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="list-filters">
      {select("department", "部门", departments)}
      {training && select("position", "岗位", positions)}
      {select("employee", "员工", employees)}
      {training && (
        <label>
          负责人
          <input
            aria-label="负责人筛选"
            value={value.owner}
            onChange={(event) => onChange({ ...value, owner: event.target.value })}
          />
        </label>
      )}
      {select(
        "status",
        "状态",
        Object.entries(statuses).map(([id, name]) => ({ id, name })),
      )}
      {training &&
        select(
          "type",
          "培训类型",
          Object.entries(trainingTypeLabels).map(([id, name]) => ({ id, name })),
        )}
      {training &&
        select("progress", "进度", [
          { id: "none", name: "未完成" },
          { id: "partial", name: "部分完成" },
          { id: "complete", name: "全部完成" },
        ])}
      <label>
        开始日期
        <input
          aria-label="开始日期筛选"
          type="date"
          value={value.from}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
        />
      </label>
      <label>
        结束日期
        <input
          aria-label="结束日期筛选"
          type="date"
          value={value.to}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
        />
      </label>
      <button type="button" onClick={() => onChange({ ...emptyListFilters })}>
        重置筛选
      </button>
    </div>
  );
}

export function TrainingManagement({ session }: { session: Session }) {
  const canManage = ["hr_admin", "department_manager"].includes(session.role);
  const [state, setState] = useState<{
    plans: TrainingPlanView[];
    tasks: TrainingTaskView[];
    materials: Option[];
    employees: Option[];
    departments: Option[];
    positions: Option[];
  }>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [form, setForm] = useState(emptyForm);
  const [planFilters, setPlanFilters] = useState({ ...emptyListFilters });
  const [taskFilters, setTaskFilters] = useState({ ...emptyListFilters });
  const load = async () => {
    setError("");
    try {
      const [tasks, plans, materials, employees, departments, positions] = await Promise.all([
        request<TrainingTaskView[]>("/api/training-tasks"),
        canManage ? request<TrainingPlanView[]>("/api/training-plans") : [],
        canManage ? request<Option[]>("/api/training-materials") : [],
        canManage ? request<Option[]>("/api/organization/employees?active=true") : [],
        canManage ? request<Option[]>("/api/organization/departments") : [],
        canManage ? request<Option[]>("/api/organization/positions") : [],
      ]);
      setState({ tasks, plans, materials, employees, departments, positions });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
    }
  };
  useEffect(() => {
    void load();
  }, [session.accountId]);
  const mutate = async (path: string, method = "POST", body?: unknown) => {
    if (busy) return false;
    setBusy(true);
    setNotice("");
    try {
      await request(path, method, body);
      setNotice("操作成功");
      await load();
      return true;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "操作失败");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const edit = (plan: TrainingPlanView) => {
    const local = (value: string) => {
      const d = new Date(value);
      return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 16);
    };
    setEditing(plan.id);
    setForm({
      title: plan.title,
      trainingType: plan.trainingType,
      materialIds: plan.materialIds ?? [plan.materialId],
      ownerEmployeeIds: plan.ownerEmployeeIds ?? [plan.ownerEmployeeId],
      startAt: local(plan.startAt),
      dueAt: local(plan.dueAt),
      historicalCompleted: plan.historicalCompleted ?? false,
      location: plan.location,
      scopeType: plan.scopeType,
      scopeDepartmentIds:
        plan.scopeDepartmentIds ?? (plan.scopeDepartmentId ? [plan.scopeDepartmentId] : []),
      scopePositionIds:
        plan.scopePositionIds ?? (plan.scopePositionId ? [plan.scopePositionId] : []),
      scopeEmployeeIds: plan.scopeEmployeeIds,
    });
  };
  const materialLinks = (row: TrainingPlanView | TrainingTaskView) =>
    (row.materials ?? [{ id: row.materialId, title: row.materialTitle }]).map((m) => (
      <span key={m.id}>
        <MaterialPreviewButton
          url={`/api/training-materials/${m.id}/content`}
          label={`预览 ${m.title}`}
        />
        {" · "}
        <a href={`/api/training-materials/${m.id}/content`}>查看/下载</a>
        <br />
      </span>
    ));
  const planActions = (plan: TrainingPlanView) => (
    <div className="action-row">
      {plan.status === "draft" && (
        <>
          <button disabled={busy} onClick={() => edit(plan)}>
            编辑
          </button>
          <button disabled={busy} onClick={() => mutate(`/api/training-plans/${plan.id}/submit`)}>
            提交审批
          </button>
        </>
      )}
      {plan.status === "pending_approval" &&
        plan.createdByAccountId !== session.accountId &&
        plan.submittedByAccountId !== session.accountId && (
          <>
            <button
              disabled={busy}
              onClick={() => mutate(`/api/training-plans/${plan.id}/approve`)}
            >
              审批通过
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("请填写退回原因");
                if (reason)
                  void mutate(`/api/training-plans/${plan.id}/reject`, "POST", { reason });
              }}
            >
              退回修改
            </button>
          </>
        )}
      {["pending_approval", "published", "in_progress"].includes(plan.status) && (
        <button disabled={busy} onClick={() => mutate(`/api/training-plans/${plan.id}/withdraw`)}>
          撤回修改
        </button>
      )}
      {["draft", "pending_approval", "published", "in_progress"].includes(plan.status) && (
        <button disabled={busy} onClick={() => mutate(`/api/training-plans/${plan.id}/cancel`)}>
          取消计划
        </button>
      )}
      {["draft", "cancelled"].includes(plan.status) && (
        <button disabled={busy} onClick={() => mutate(`/api/training-plans/${plan.id}`, "DELETE")}>
          删除
        </button>
      )}
    </div>
  );
  const taskActions = (task: TrainingTaskView) => (
    <>
      {materialLinks(task)}
      {task.evidence.map((evidence) => (
        <div key={evidence.id}>
          <MaterialPreviewButton
            url={`/api/training-evidence/${evidence.id}/content`}
            label={`预览签到证据：${evidence.filename}`}
          />{" "}
          <a href={`/api/training-evidence/${evidence.id}/content`}>
            下载签到证据：{evidence.filename}
          </a>
        </div>
      ))}
      {canManage && task.status === "submitted" && task.employeeId !== session.employeeId && (
        <div className="action-row">
          <button disabled={busy} onClick={() => mutate(`/api/training-tasks/${task.id}/confirm`)}>
            确认历史提交
          </button>
          <button
            disabled={busy}
            onClick={() => {
              const reason = window.prompt("请填写退回原因");
              if (reason) void mutate(`/api/training-tasks/${task.id}/return`, "POST", { reason });
            }}
          >
            退回历史提交
          </button>
        </div>
      )}
      {canManage &&
        (task.ownerEmployeeIds ?? [task.ownerEmployeeId]).includes(session.employeeId) && (
          <>
            {["assigned", "returned"].includes(task.status) && (
              <button
                disabled={busy}
                onClick={() => mutate(`/api/training-tasks/${task.id}/start`)}
              >
                开始培训
              </button>
            )}
            {task.status === "in_progress" && (
              <button
                disabled={busy}
                onClick={() => mutate(`/api/training-tasks/${task.id}/complete`)}
              >
                完成培训
              </button>
            )}
          </>
        )}
    </>
  );
  if (error)
    return (
      <section className="panel" role="alert">
        {error}
        <button onClick={load}>重新加载</button>
      </section>
    );
  if (!state) return <section className="panel">正在加载培训计划与任务…</section>;
  const chinaDay = (value: string) =>
    new Date(new Date(value).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const baseMatch = (
    row: {
      trainingType: string;
      status: string;
      startAt: string;
      ownerName: string;
      ownerNames?: string[];
    },
    filters: ListFilters,
    completed: number,
    total: number,
  ) =>
    (!filters.type || row.trainingType === filters.type) &&
    (!filters.status || row.status === filters.status) &&
    (!filters.owner ||
      (row.ownerNames ?? [row.ownerName]).some((name) => name.includes(filters.owner))) &&
    (!filters.from || chinaDay(row.startAt) >= filters.from) &&
    (!filters.to || chinaDay(row.startAt) <= filters.to) &&
    (!filters.progress ||
      (filters.progress === "none"
        ? completed === 0
        : filters.progress === "complete"
          ? total > 0 && completed === total
          : completed > 0 && completed < total));
  const planTargets = (p: TrainingPlanView) =>
    state.employees.filter((e) =>
      p.scopeType === "employees"
        ? p.scopeEmployeeIds.includes(e.id)
        : p.scopeType === "department"
          ? (p.scopeDepartmentIds ?? [p.scopeDepartmentId]).includes(e.departmentId)
          : (p.scopePositionIds ?? [p.scopePositionId]).includes(e.positionId),
    );
  const participantCount = (p: TrainingPlanView) =>
    ["draft", "pending_approval"].includes(p.status) ? planTargets(p).length : p.taskCount;
  const plans = state.plans.filter(
    (p) =>
      baseMatch(p, planFilters, p.confirmedCount, participantCount(p)) &&
      (!planFilters.department || p.departments.some((d) => d.id === planFilters.department)) &&
      (!planFilters.position || p.positions.some((d) => d.id === planFilters.position)) &&
      (!planFilters.employee ||
        planTargets(p).some((e) => e.id === planFilters.employee) ||
        state.tasks.some((t) => t.planId === p.id && t.employeeId === planFilters.employee)),
  );
  const tasks = state.tasks.filter(
    (t) =>
      baseMatch(t, taskFilters, t.status === "confirmed" ? 1 : 0, 1) &&
      (!taskFilters.department || t.departmentId === taskFilters.department) &&
      (!taskFilters.position || t.positionId === taskFilters.position) &&
      (!taskFilters.employee || t.employeeId === taskFilters.employee),
  );
  const unique = (options: Array<{ id: string; name: string }>) => [
    ...new Map(options.map((o) => [o.id, o])).values(),
  ];
  const departments = unique([
    ...state.departments.map((d) => ({ id: d.id, name: d.name ?? "" })),
    ...state.tasks.map((t) => ({ id: t.departmentId, name: t.departmentName })),
  ]);
  const positions = unique([
    ...state.positions.map((d) => ({ id: d.id, name: d.name ?? "" })),
    ...state.tasks
      .filter((t) => t.positionId)
      .map((t) => ({ id: t.positionId!, name: t.positionName ?? "" })),
  ]);
  const employees = unique([
    ...state.employees.map((d) => ({ id: d.id, name: d.displayName ?? "" })),
    ...state.tasks.map((t) => ({ id: t.employeeId, name: t.employeeName })),
  ]);
  return (
    <div className="training-management">
      <style>{`.training-mobile{display:none}.training-management table{width:100%;border-collapse:collapse}.training-management th,.training-management td{padding:10px;text-align:left;border-bottom:1px solid #dfe5e9}.training-management fieldset{margin:12px 0}.training-management form>label{display:inline-flex;flex-direction:column;margin:8px;gap:6px}.training-management article{padding:16px;margin:12px 0;border:1px solid #dfe5e9;border-radius:10px}@media(max-width:760px){.training-desktop{display:none}.training-mobile{display:block}}`}</style>
      {notice && <p role="status">{notice}</p>}
      {canManage && (
        <>
          <section className="panel">
            <h2>{editing ? "编辑培训计划" : "新建培训计划"}</h2>
            <p>
              计划时间使用中国时区，可选择过去日期补录历史计划，结束时间须晚于开始时间。
              已完成的历史培训审批通过后自动完成；其他培训由负责人手动开始、完成。
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (new Date(`${form.dueAt}:00+08:00`) <= new Date(`${form.startAt}:00+08:00`)) {
                  setNotice("结束时间须晚于开始时间");
                  return;
                }
                if (
                  await mutate(
                    editing ? `/api/training-plans/${editing}` : "/api/training-plans",
                    editing ? "PATCH" : "POST",
                    {
                      ...form,
                      startAt: new Date(`${form.startAt}:00+08:00`).toISOString(),
                      dueAt: new Date(`${form.dueAt}:00+08:00`).toISOString(),
                    },
                  )
                ) {
                  setForm(emptyForm());
                  setEditing(undefined);
                }
              }}
            >
              <label>
                培训类型
                <select
                  value={form.trainingType}
                  onChange={(e) =>
                    setForm({ ...form, trainingType: e.target.value as TrainingType })
                  }
                >
                  {trainingTypes.map((type) => (
                    <option key={type} value={type}>
                      {trainingTypeLabels[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                计划名称
                <input
                  required
                  maxLength={150}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
              <label>
                开始时间
                <input
                  required
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                />
              </label>
              <label>
                结束时间
                <input
                  required
                  type="datetime-local"
                  value={form.dueAt}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      dueAt: e.target.value,
                      historicalCompleted:
                        new Date(`${e.target.value}:00+08:00`).getTime() <= Date.now(),
                    })
                  }
                />
              </label>
              <fieldset>
                <legend>完成方式</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={form.historicalCompleted}
                    disabled={!(new Date(`${form.dueAt}:00+08:00`).getTime() <= Date.now())}
                    onChange={(e) => setForm({ ...form, historicalCompleted: e.target.checked })}
                  />
                  补录已完成培训
                </label>
                <p>
                  {form.historicalCompleted
                    ? "审批通过后，所有参训员工自动标为已完成，以上开始、结束时间将保存为实际培训时间。"
                    : "由负责人手动点击开始、完成培训，实际时间记录为操作时间。"}
                  过去日期默认勾选；逾期但未完成的培训请取消勾选。
                </p>
              </fieldset>
              <label>
                培训地点
                <input
                  required
                  maxLength={150}
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </label>
              <MultiSelect
                label="培训资料"
                options={state.materials}
                value={form.materialIds}
                onChange={(value) => setForm({ ...form, materialIds: value })}
              />
              <MultiSelect
                label="负责人"
                options={state.employees.filter(
                  (e) => e.role === "hr_admin" || e.role === "department_manager",
                )}
                value={form.ownerEmployeeIds}
                onChange={(value) => setForm({ ...form, ownerEmployeeIds: value })}
              />
              <label>
                培训对象
                <select
                  value={form.scopeType}
                  onChange={(e) =>
                    setForm({ ...form, scopeType: e.target.value as TrainingScopeType })
                  }
                >
                  <option value="department">按部门</option>
                  <option value="position">按岗位</option>
                  <option value="employees">指定员工</option>
                </select>
              </label>
              {form.scopeType === "department" ? (
                <MultiSelect
                  label="部门"
                  options={state.departments}
                  value={form.scopeDepartmentIds}
                  onChange={(value) => setForm({ ...form, scopeDepartmentIds: value })}
                />
              ) : form.scopeType === "position" ? (
                <MultiSelect
                  label="岗位"
                  options={state.positions}
                  value={form.scopePositionIds}
                  onChange={(value) => setForm({ ...form, scopePositionIds: value })}
                />
              ) : (
                <MultiSelect
                  label="员工"
                  options={state.employees}
                  value={form.scopeEmployeeIds}
                  onChange={(value) => setForm({ ...form, scopeEmployeeIds: value })}
                />
              )}
              <button disabled={busy} type="submit">
                保存草稿
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(undefined);
                    setForm(emptyForm());
                  }}
                >
                  退出编辑
                </button>
              )}
            </form>
          </section>
          <section className="panel">
            <h2>培训计划</h2>
            <ListFilterBar
              value={planFilters}
              onChange={setPlanFilters}
              departments={departments}
              positions={positions}
              employees={employees}
              statuses={planLabels}
              training
            />
            {plans.length === 0 ? (
              <p>暂无培训计划</p>
            ) : (
              <>
                <div className="training-desktop">
                  <table>
                    <thead>
                      <tr>
                        <th>序号</th>
                        <th>计划 / 类型</th>
                        <th>资料 / 负责人</th>
                        <th>时间 / 地点</th>
                        <th>对象 / 人数 / 进度</th>
                        <th>状态 / 操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map((p, index) => (
                        <tr key={p.id}>
                          <td>{index + 1}</td>
                          <td>
                            {p.title}
                            <br />
                            {trainingTypeLabels[p.trainingType]}
                          </td>
                          <td>
                            {materialLinks(p)}
                            {p.ownerNames?.join("、") ?? p.ownerName}
                          </td>
                          <td>
                            {date(p.startAt)}
                            <br />
                            {date(p.dueAt)}
                            <br />
                            {p.location}
                          </td>
                          <td>
                            {[
                              ...p.departments.map((d) => d.name),
                              ...p.positions.map((d) => d.name),
                              ...p.scopeEmployeeNames,
                            ].join("、")}
                            <br />
                            {participantCount(p)} 人 /{" "}
                            {p.taskCount ? Math.round((p.confirmedCount / p.taskCount) * 100) : 0}%
                          </td>
                          <td>
                            {planLabels[p.status]}
                            {p.historicalCompleted && <p>历史补录 · 审批后自动完成</p>}
                            {p.approvalComment && <p>退回原因：{p.approvalComment}</p>}
                            {planActions(p)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="training-mobile">
                  {plans.map((p, index) => (
                    <article key={p.id}>
                      <h3>
                        {index + 1}. {p.title}
                      </h3>
                      <p>
                        {trainingTypeLabels[p.trainingType]} · {planLabels[p.status]}
                      </p>
                      {p.historicalCompleted && <p>历史补录 · 审批后自动完成</p>}
                      <p>
                        {date(p.startAt)} — {date(p.dueAt)} · {p.location}
                      </p>
                      <p>
                        负责人：{p.ownerNames?.join("、") ?? p.ownerName} · {p.confirmedCount}/
                        {participantCount(p)} 人完成
                      </p>
                      <p>
                        培训对象：
                        {[
                          ...p.departments.map((d) => d.name),
                          ...p.positions.map((d) => d.name),
                          ...p.scopeEmployeeNames,
                        ].join("、") || "—"}
                      </p>
                      {p.approvalComment && <p>{p.approvalComment}</p>}
                      {materialLinks(p)}
                      {planActions(p)}
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
      <section className="panel">
        <h2>{canManage ? "培训任务" : "我的培训"}</h2>
        <ListFilterBar
          value={taskFilters}
          onChange={setTaskFilters}
          departments={departments}
          positions={positions}
          employees={employees}
          statuses={taskLabels}
          training
        />
        {!tasks.length ? (
          <p>暂无培训任务</p>
        ) : (
          <>
            <div className="training-desktop">
              <table>
                <thead>
                  <tr>
                    <th>序号</th>
                    <th>计划 / 对象</th>
                    <th>负责人</th>
                    <th>计划时间</th>
                    <th>实际时间</th>
                    <th>状态 / 操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t, index) => (
                    <tr key={t.id}>
                      <td>{index + 1}</td>
                      <td>
                        {t.planTitle}
                        <br />
                        {trainingTypeLabels[t.trainingType]} · {t.employeeName}（{t.employeeNumber}
                        ）
                        <br />
                        {t.departmentName} · {t.positionName ?? "未分配岗位"}
                      </td>
                      <td>{t.ownerNames?.join("、") ?? t.ownerName}</td>
                      <td>
                        {date(t.startAt)}
                        <br />
                        {date(t.dueAt)}
                      </td>
                      <td>
                        {date(t.actualStartAt)}
                        <br />
                        {date(t.actualCompletedAt)}
                      </td>
                      <td>
                        {taskLabels[t.status]}
                        {t.overdue && <p>已逾期</p>}
                        {t.returnReason && <p>退回原因：{t.returnReason}</p>}
                        <br />
                        {taskActions(t)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="training-mobile">
              {tasks.map((t, index) => (
                <article key={t.id}>
                  <h3>
                    {index + 1}. {t.planTitle}
                  </h3>
                  <p>
                    {t.employeeName}（{t.employeeNumber}） · {taskLabels[t.status]}
                  </p>
                  <p>
                    部门：{t.departmentName} · 岗位：{t.positionName ?? "—"}
                  </p>
                  <p>
                    类型：{trainingTypeLabels[t.trainingType]} · 负责人：
                    {t.ownerNames?.join("、") ?? t.ownerName}
                  </p>
                  <p>地点：{t.location}</p>
                  {t.overdue && <p>已逾期</p>}
                  {t.returnReason && <p>退回原因：{t.returnReason}</p>}
                  <p>
                    计划：{date(t.startAt)} — {date(t.dueAt)}
                  </p>
                  <p>
                    实际：{date(t.actualStartAt)} — {date(t.actualCompletedAt)}
                  </p>
                  {taskActions(t)}
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
