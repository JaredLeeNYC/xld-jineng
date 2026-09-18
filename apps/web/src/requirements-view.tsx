import { useEffect, useState } from "react";
import type { PositionSkillRequirementView } from "@jineng/skill-matrix-shared";

export function RequirementsView() {
  const [rows, setRows] = useState<PositionSkillRequirementView[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  async function load() {
    setStatus("loading");
    try {
      const response = await fetch("/api/position-skill-requirements", { credentials: "include" });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error.message);
      setRows(result.data);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
      setStatus("error");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const departments = [
    ...new Map(rows.map((row) => [row.departmentId, row.departmentName])).entries(),
  ];
  const positions = [
    ...new Map(
      rows
        .filter((row) => !departmentId || row.departmentId === departmentId)
        .map((row) => [row.positionId, row.positionName]),
    ).entries(),
  ];
  const filtered = rows.filter(
    (row) =>
      (!departmentId || row.departmentId === departmentId) &&
      (!positionId || row.positionId === positionId),
  );
  return (
    <section className="panel requirement-list">
      <h1>当前岗位要求</h1>
      <p>查看各部门岗位要求；修改由 HR 维护。</p>
      {status === "loading" ? (
        <p role="status">正在加载岗位要求…</p>
      ) : status === "error" ? (
        <div role="alert">
          {error}
          <button type="button" onClick={() => void load()}>
            重新加载
          </button>
        </div>
      ) : (
        <>
          <div className="filter-bar">
            <label>
              部门
              <select
                value={departmentId}
                onChange={(event) => {
                  setDepartmentId(event.target.value);
                  setPositionId("");
                }}
              >
                <option value="">全部部门</option>
                {departments.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              岗位
              <select value={positionId} onChange={(event) => setPositionId(event.target.value)}>
                <option value="">全部岗位</option>
                {positions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!filtered.length ? (
            <p className="list-state">当前筛选暂无岗位要求</p>
          ) : (
            <>
              <div className="requirement-table-wrap">
                <table className="skill-table">
                  <thead>
                    <tr>
                      <th>部门</th>
                      <th>岗位</th>
                      <th>技能</th>
                      <th>等级</th>
                      <th>类型</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id}>
                        <td>{row.departmentName}</td>
                        <td>{row.positionName}</td>
                        <td>{row.skillName}</td>
                        <td>L{row.requiredLevel}</td>
                        <td>{row.required ? "必备" : "非必备"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="requirement-cards">
                {filtered.map((row) => (
                  <article key={row.id}>
                    <strong>
                      {row.departmentName} · {row.positionName}
                    </strong>
                    <p>
                      {row.skillName} · L{row.requiredLevel} · {row.required ? "必备" : "非必备"}
                    </p>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
