import "./training-exams.css";
import { useEffect, useState, type FormEvent } from "react";
import {
  trainingExamMethodLabels,
  type TrainingExamView,
  type TrainingExamMethod,
} from "../../../packages/shared/src/training-exam";
import type {
  TrainingPlanView,
  TrainingTaskView,
  SkillView,
  TrainingMaterialView,
} from "@jineng/skill-matrix-shared";
import type { Session } from "./app";
type Employee = {
  id: string;
  displayName: string;
  departmentId?: string;
  departmentName?: string;
  active: boolean;
};
const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  const response = await fetch(path, { credentials: "include", ...init, headers });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error?.message ?? "加载失败");
  return result.data as T;
};
const dateText = (date: string) =>
  new Date(date).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
export function TrainingExamsPage({ session }: { session: Session }) {
  const canEdit = session.role === "hr_admin" || session.role === "department_manager";
  const [rows, setRows] = useState<TrainingExamView[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [plans, setPlans] = useState<TrainingPlanView[]>([]);
  const [tasks, setTasks] = useState<TrainingTaskView[]>([]);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [materials, setMaterials] = useState<TrainingMaterialView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [departmentId, setDepartmentId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [planId, setPlanId] = useState("");
  const [skillId, setSkillId] = useState("");
  const [filter, setFilter] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await api<TrainingExamView[]>("/api/training-exams"));
      if (canEdit) {
        const [e, p, t, s, m] = await Promise.all([
          api<Employee[]>("/api/organization/employees"),
          api<TrainingPlanView[]>("/api/training-plans"),
          api<TrainingTaskView[]>("/api/training-tasks"),
          api<SkillView[]>("/api/skills"),
          api<TrainingMaterialView[]>("/api/training-materials"),
        ]);
        setEmployees(e);
        setPlans(p);
        setTasks(t);
        setSkills(s);
        setMaterials(m);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [session.accountId]);
  const eligiblePlans = plans.filter((p) =>
    tasks.some((t) => t.planId === p.id && t.employeeId === employeeId && t.status !== "cancelled"),
  );
  const selectedPlan = plans.find((p) => p.id === planId);
  const linkedSkillIds =
    selectedPlan?.materials?.flatMap((m) => m.skillIds ?? []) ??
    materials
      .filter((m) => (selectedPlan?.materialIds ?? [selectedPlan?.materialId]).includes(m.id))
      .flatMap((m) => m.skillIds);
  const eligibleSkills = skills.filter(
    (s) => s.active && (!linkedSkillIds.length || linkedSkillIds.includes(s.id)),
  );
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (key: string) => {
      const value = data.get(key);
      return typeof value === "string" ? value : "";
    };
    try {
      await api("/api/training-exams", {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          planId,
          skillId,
          method: data.get("method") as TrainingExamMethod,
          score: Number(data.get("score")),
          passed: data.get("passed") === "true",
          completedAt: new Date(`${text("completedAt")}:00+08:00`).toISOString(),
          remarks: text("remarks"),
        }),
      });
      form.reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };
  const visible = rows.filter((row) =>
    `${row.employeeName} ${row.departmentName} ${row.skillName} ${row.planTitle}`.includes(filter),
  );
  return (
    <section className="panel training-exam-page">
      <h2>{canEdit ? "培训考核档案" : "个人培训考核档案"}</h2>
      {loading && <p role="status">正在加载培训考核档案…</p>}
      {error && (
        <div role="alert">
          {error} <button onClick={() => void load()}>重新加载</button>
        </div>
      )}
      {canEdit && !loading && (
        <form className="exam-entry-form" onSubmit={save}>
          <label>
            部门
            <select
              required
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setEmployeeId("");
                setPlanId("");
                setSkillId("");
              }}
            >
              <option value="">请选择部门</option>
              {Array.from(
                new Map(
                  employees
                    .filter((e) => e.active && e.departmentId)
                    .map((e) => [e.departmentId!, e.departmentName ?? "未命名部门"]),
                ),
              ).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            员工
            <select
              required
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                setPlanId("");
                setSkillId("");
              }}
            >
              <option value="">请选择员工</option>
              {employees
                .filter((e) => e.active && e.departmentId === departmentId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            所属计划
            <select
              required
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value);
                setSkillId("");
              }}
            >
              <option value="">请选择所属计划</option>
              {eligiblePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            关联课程 / 技能
            <select required value={skillId} onChange={(e) => setSkillId(e.target.value)}>
              <option value="">请选择技能</option>
              {eligibleSkills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            考核方式
            <select name="method">
              {Object.entries(trainingExamMethodLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            考核成绩
            <input required name="score" type="number" min="0" max="100" step="0.01" />
          </label>
          <label>
            结果
            <select name="passed">
              <option value="true">合格</option>
              <option value="false">不合格</option>
            </select>
          </label>
          <label>
            完成时间（中国时间）
            <input required name="completedAt" type="datetime-local" />
          </label>
          <label>
            备注
            <input name="remarks" maxLength={500} />
          </label>
          <button disabled={saving} type="submit">
            {saving ? "保存中…" : "保存考核档案"}
          </button>
        </form>
      )}
      <label>
        筛选档案
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="员工、部门、技能或计划"
        />
      </label>
      {!loading && !error && visible.length === 0 && <p>暂无符合条件的培训考核档案</p>}
      {visible.length > 0 && (
        <>
          <div className="material-table">
            <table>
              <thead>
                <tr>
                  {[
                    "序号",
                    "员工",
                    "部门",
                    "关联课程 / 技能",
                    "考核方式",
                    "成绩",
                    "结果",
                    "完成时间（中国时间）",
                    "所属计划",
                    "备注",
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((x, index) => (
                  <tr key={x.id}>
                    <td>{index + 1}</td>
                    <td>{x.employeeName}</td>
                    <td>{x.departmentName}</td>
                    <td>{x.skillName}</td>
                    <td>{trainingExamMethodLabels[x.method]}</td>
                    <td>{x.score}</td>
                    <td>{x.passed ? "合格" : "不合格"}</td>
                    <td>{dateText(x.completedAt)}</td>
                    <td>{x.planTitle}</td>
                    <td>{x.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="material-cards">
            {visible.map((x, index) => (
              <article className="master-card" key={x.id}>
                <h3>
                  {index + 1}. {x.employeeName} · {x.skillName}
                </h3>
                <p>
                  {x.departmentName} · {x.planTitle}
                </p>
                <p>
                  {trainingExamMethodLabels[x.method]} · {x.score} 分 ·{" "}
                  {x.passed ? "合格" : "不合格"}
                </p>
                <p>完成时间（中国时间）：{dateText(x.completedAt)}</p>
                <p>备注：{x.remarks || "—"}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
