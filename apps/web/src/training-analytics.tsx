import { useEffect, useState } from "react";
import type { TrainingAnalytics } from "../../../packages/shared/src/training-analytics";
import "./training-analytics.css";

const statuses: Record<string, string> = {
  draft: "草稿",
  pending_approval: "待审批",
  published: "已发布",
  in_progress: "进行中",
  completed: "已完成",
};
export function TrainingAnalyticsPanel({
  departments: initialDepartments,
  canReadFactory = false,
  departmentId,
}: {
  departments?: Array<{ id: string; name: string }>;
  canReadFactory?: boolean;
  departmentId?: string;
}) {
  const [departments, setDepartments] = useState(initialDepartments ?? []);
  const [departmentError, setDepartmentError] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [selected, setSelected] = useState(canReadFactory ? "" : (departmentId ?? ""));
  const [data, setData] = useState<TrainingAnalytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (initialDepartments) return;
    const controller = new AbortController();
    setDepartmentError("");
    fetch("/api/organization/departments", { credentials: "include", signal: controller.signal })
      .then((r) => r.json())
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) throw new Error(result.error?.message ?? "部门加载失败");
        setDepartments(result.data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setDepartmentError(cause instanceof Error ? cause.message : "部门加载失败");
      });
    return () => controller.abort();
  }, [initialDepartments, reload]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    const params = new URLSearchParams({
      year: String(year),
      ...(selected ? { departmentId: selected } : {}),
    });
    fetch(`/api/reports/training-analytics?${params}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) throw new Error(result.error?.message ?? "培训统计加载失败");
        setData(result.data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "培训统计加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [year, selected, reload]);
  return (
    <section className="panel training-analytics">
      <h2>年度培训计划与时数统计</h2>
      <div className="action-row">
        <label>
          年度{" "}
          <input
            aria-label="培训统计年度"
            type="number"
            min="2000"
            max="2100"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        {canReadFactory && (
          <label>
            统计范围{" "}
            <select
              aria-label="培训统计部门"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">全厂年度培训计划</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}年度培训计划
                </option>
              ))}
            </select>
          </label>
        )}
        <button onClick={() => setReload((v) => v + 1)}>刷新统计</button>
      </div>
      {departmentError && (
        <p role="alert">
          {departmentError}
          <button onClick={() => setReload((v) => v + 1)}>重试部门加载</button>
        </p>
      )}
      {loading ? (
        <p role="status">正在加载培训统计…</p>
      ) : error ? (
        <p role="alert">
          {error}
          <button onClick={() => setReload((v) => v + 1)}>重试</button>
        </p>
      ) : (
        data && (
          <>
            <p>
              {data.departmentId
                ? `${departments.find((d) => d.id === data.departmentId)?.name ?? "本部门"}年度培训计划`
                : "全厂年度培训计划"}{" "}
              · 当前在岗人数：{data.employeeCount} 人
            </p>
            <p className="muted">
              计划时数按授课计划计一次；计划人时＝计划小时×参训人数；实际人时为各员工已完成培训的登记小时之和（含历史离职人员的已完成记录）。月参训人数按员工去重。月人均与年累计人均均除以当前范围在岗人数，无在岗人员显示
              —。月份按北京时间，计划按开始时间，实际按完成时间。未登记时数不推算、不计入合计，合计可能不完整。
            </p>
            <div className="analytics-desktop">
              <table>
                <thead>
                  <tr>
                    {[
                      "月份",
                      "参训人数",
                      "计划时数",
                      "计划人时",
                      "实际人时",
                      "月人均",
                      "年累计人均",
                      "未登记计划/实际",
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((m) => (
                    <tr key={m.month}>
                      <td>{m.month}月</td>
                      <td>{m.employeesTrained}</td>
                      <td>{m.plannedHours}</td>
                      <td>{m.plannedPersonHours}</td>
                      <td>{m.actualPersonHours}</td>
                      <td>{m.averageHours ?? "—"}</td>
                      <td>{m.cumulativeAverageHours ?? "—"}</td>
                      <td>
                        {m.missingPlannedHours} / {m.missingActualHours}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="analytics-mobile">
              {data.months.map((m) => (
                <article key={m.month}>
                  <h3>
                    {m.month}月 · 参训 {m.employeesTrained} 人
                  </h3>
                  <p>
                    计划 {m.plannedHours} 小时 · 计划 {m.plannedPersonHours} 人时 · 实际{" "}
                    {m.actualPersonHours} 人时
                  </p>
                  <p>
                    月人均 {m.averageHours ?? "—"} · 年累计人均 {m.cumulativeAverageHours ?? "—"}
                  </p>
                  <p>
                    未登记计划 {m.missingPlannedHours} 项 / 实际 {m.missingActualHours} 人次
                  </p>
                </article>
              ))}
            </div>
            <h3>年度计划明细（{data.plans.length} 项）</h3>
            <p className="muted">
              包含草稿和待审批计划，已取消计划除外。未发布计划参训人数按当前有效对象预估，发布后按实际分配任务统计。
            </p>
            {!data.plans.length ? (
              <p>本年度暂无培训计划</p>
            ) : (
              <>
                <div className="analytics-desktop">
                  <table>
                    <thead>
                      <tr>
                        <th>培训计划</th>
                        <th>状态</th>
                        <th>计划开始</th>
                        <th>计划结束</th>
                        <th>授课小时</th>
                        <th>范围内参训人数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.plans.map((p) => (
                        <tr key={p.id}>
                          <td>{p.title}</td>
                          <td>{statuses[p.status]}</td>
                          <td>
                            {new Date(p.startAt).toLocaleDateString("zh-CN", {
                              timeZone: "Asia/Shanghai",
                            })}
                          </td>
                          <td>
                            {new Date(p.dueAt).toLocaleDateString("zh-CN", {
                              timeZone: "Asia/Shanghai",
                            })}
                          </td>
                          <td>{p.plannedHours ?? "未登记"}</td>
                          <td>{p.participantCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="analytics-mobile">
                  {data.plans.map((p) => (
                    <article key={p.id}>
                      <h4>
                        {p.title} · {statuses[p.status]}
                      </h4>
                      <p>
                        {new Date(p.startAt).toLocaleDateString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                        })}{" "}
                        —{" "}
                        {new Date(p.dueAt).toLocaleDateString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                        })}
                      </p>
                      <p>
                        计划 {p.plannedHours ?? "未登记"} 小时 · {p.participantCount} 人
                      </p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        )
      )}
    </section>
  );
}
