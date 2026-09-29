import { useEffect, useState } from "react";
import type {
  AnnualTrainingPlan,
  TrainingAnalytics,
} from "../../../packages/shared/src/training-analytics";
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
  showPlanDetails = true,
  showStatistics = true,
}: {
  departments?: Array<{ id: string; name: string }>;
  canReadFactory?: boolean;
  departmentId?: string;
  showPlanDetails?: boolean;
  showStatistics?: boolean;
}) {
  const [departments, setDepartments] = useState(initialDepartments ?? []);
  const [departmentError, setDepartmentError] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [selected, setSelected] = useState(canReadFactory ? "" : (departmentId ?? ""));
  const [areaId, setAreaId] = useState("");
  const [areas, setAreas] = useState<Array<{ id: string; name: string; departmentId: string }>>([]);
  const [areaError, setAreaError] = useState("");
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState<TrainingAnalytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!showPlanDetails) return;
    const controller = new AbortController();
    setAreaError("");
    const params = new URLSearchParams(selected ? { departmentId: selected } : {});
    fetch(`/api/organization/areas?${params}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) throw new Error(result.error?.message ?? "区域加载失败");
        setAreas(result.data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setAreaError(cause instanceof Error ? cause.message : "区域加载失败");
      });
    return () => controller.abort();
  }, [selected, showPlanDetails, reload]);
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
    if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) {
      setError("请输入 2000–2100 之间的完整年度");
      setLoading(false);
      return () => controller.abort();
    }
    const params = new URLSearchParams({
      year: String(year),
      ...(selected ? { departmentId: selected } : {}),
      ...(showPlanDetails && areaId ? { areaId } : {}),
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
  }, [year, selected, areaId, showPlanDetails, reload]);
  const filteredPlans = filterAnnualPlans(data?.plans ?? [], month, status);
  return (
    <section className="panel training-analytics">
      <h2>{showStatistics ? "年度培训计划与时数统计" : "年度培训计划汇总表"}</h2>
      <div className="action-row">
        <label>
          年度{" "}
          <input
            aria-label="培训统计年度"
            type="number"
            min="2000"
            max="2100"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </label>
        {canReadFactory && (
          <label>
            统计范围{" "}
            <select
              aria-label="培训统计部门"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setAreaId("");
              }}
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
        {showPlanDetails && (
          <>
            <label>
              区域{" "}
              <select
                aria-label="年度培训计划区域"
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
              >
                <option value="">全部区域</option>
                {areas
                  .filter((a) => !selected || a.departmentId === selected)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              月份{" "}
              <select
                aria-label="年度培训计划月份"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              >
                <option value="">全部月份</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}月
                  </option>
                ))}
              </select>
            </label>
            <label>
              状态{" "}
              <select
                aria-label="年度培训计划状态"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">全部状态</option>
                {Object.entries(statuses).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setSelected(canReadFactory ? "" : (departmentId ?? ""));
                setAreaId("");
                setMonth("");
                setStatus("");
              }}
            >
              重置筛选
            </button>
          </>
        )}
        <button onClick={() => setReload((v) => v + 1)}>刷新</button>
      </div>
      {areaError && (
        <p role="alert">
          {areaError}
          <button onClick={() => setReload((v) => v + 1)}>重试区域加载</button>
        </p>
      )}
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
            {showStatistics && (
              <>
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
                        月人均 {m.averageHours ?? "—"} · 年累计人均{" "}
                        {m.cumulativeAverageHours ?? "—"}
                      </p>
                      <p>
                        未登记计划 {m.missingPlannedHours} 项 / 实际 {m.missingActualHours} 人次
                      </p>
                    </article>
                  ))}
                </div>
              </>
            )}
            {showPlanDetails && (
              <>
                <h3>年度计划明细（{filteredPlans.length} 项）</h3>
                <p className="muted">
                  包含草稿和待审批计划，已取消计划除外。未发布计划参训人数按当前有效对象预估，发布后按实际分配任务统计。
                </p>
                {!filteredPlans.length ? (
                  <p>当前筛选条件下暂无培训计划</p>
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
                          {filteredPlans.map((p) => (
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
                      {filteredPlans.map((p) => (
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
            )}
          </>
        )
      )}
    </section>
  );
}

export function filterAnnualPlans(plans: AnnualTrainingPlan[], month: string, status: string) {
  return plans.filter(
    (plan) =>
      (!status || plan.status === status) &&
      (!month ||
        new Date(new Date(plan.startAt).getTime() + 8 * 3600000).getUTCMonth() + 1 ===
          Number(month)),
  );
}
