import { useEffect, useState } from "react";
import type { AreaView, DepartmentView } from "@jineng/skill-matrix-shared";
type Result<T> = { ok: true; data: T } | { ok: false; error: { message: string } };
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = (await response.json()) as Result<T>;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
export function AreaManagement({
  departments,
  onChanged,
}: {
  departments: DepartmentView[];
  onChanged: () => void;
}) {
  const [areas, setAreas] = useState<AreaView[]>();
  const [error, setError] = useState("");
  const [form, setForm] = useState({ departmentId: "", name: "" });
  const [editing, setEditing] = useState<AreaView>();
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setError("");
    try {
      setAreas(await api<AreaView[]>("/api/organization/areas?includeInactive=true"));
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      await api(path, method, body);
      setEditing(undefined);
      setForm({ ...form, name: "" });
      await load();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const actions = (area: AreaView) => (
    <>
      {area.active && (
        <>
          <button disabled={busy} type="button" onClick={() => setEditing(area)}>
            编辑
          </button>
          <button
            disabled={busy}
            type="button"
            onClick={() => void save(`/api/organization/areas/${area.id}/deactivate`, "POST")}
          >
            停用
          </button>
        </>
      )}
    </>
  );
  return (
    <section className="panel" aria-label="子部门与区域管理">
      <h2>子部门 / 区域</h2>
      <p>部门下可选划分区域；未划分的部门可直接管理员工。</p>
      <form
        className="admin-reset-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(
            editing ? `/api/organization/areas/${editing.id}` : "/api/organization/areas",
            editing ? "PATCH" : "POST",
            editing ? { name: editing.name } : form,
          );
        }}
      >
        {!editing && (
          <label>
            所属部门
            <select
              required
              value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
            >
              <option value="">请选择部门</option>
              {departments
                .filter((d) => d.active)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          区域名称
          <input
            required
            maxLength={100}
            value={editing?.name ?? form.name}
            onChange={(e) =>
              editing
                ? setEditing({ ...editing, name: e.target.value })
                : setForm({ ...form, name: e.target.value })
            }
          />
        </label>
        <button disabled={busy} type="submit">
          {editing ? "保存区域" : "新增区域"}
        </button>
        {editing && (
          <button type="button" onClick={() => setEditing(undefined)}>
            取消
          </button>
        )}
      </form>
      {error && (
        <p role="alert">
          {error}
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </p>
      )}
      {!areas && !error && <p>正在加载区域…</p>}
      {areas?.length === 0 && <p>尚未设置区域，可按需新增。</p>}
      {!!areas?.length && (
        <>
          <div className="master-table-wrap">
            <table className="master-table">
              <thead>
                <tr>
                  <th>部门</th>
                  <th>区域</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {areas.map((a) => (
                  <tr key={a.id}>
                    <td>{a.departmentName}</td>
                    <td>{a.name}</td>
                    <td>{a.active ? "启用" : "停用"}</td>
                    <td>{actions(a)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="master-cards">
            {areas.map((a) => (
              <article key={a.id}>
                <h3>{a.name}</h3>
                <p>
                  {a.departmentName} · {a.active ? "启用" : "停用"}
                </p>
                {actions(a)}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
export function EmployeeAreaPicker({
  employeeId,
  departmentId,
  areaId,
  areaName,
  onChanged,
}: {
  employeeId: string;
  departmentId?: string;
  areaId?: string;
  areaName?: string;
  onChanged: () => void;
}) {
  const [areas, setAreas] = useState<AreaView[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => {
    setError("");
    void api<AreaView[]>("/api/organization/areas")
      .then(setAreas)
      .catch((e) => setError(String(e)));
  };
  return (
    <label>
      区域
      <select
        aria-label="员工所属区域"
        disabled={busy}
        value={areaId ?? ""}
        onFocus={() => {
          if (!areas) load();
        }}
        onChange={async (e) => {
          setBusy(true);
          setError("");
          try {
            await api(`/api/organization/employees/${employeeId}/area`, "PATCH", {
              areaId: e.target.value || null,
            });
            onChanged();
          } catch (err) {
            setError(String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <option value="">未分配区域</option>
        {areaId && !areas?.some((a) => a.id === areaId) && (
          <option value={areaId}>{areaName ?? "当前区域"}</option>
        )}
        {areas
          ?.filter((a) => a.departmentId === departmentId)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
      {error && <span role="alert">{error}</span>}
    </label>
  );
}

export function AreaSelect({
  departmentId,
  value,
  onChange,
}: {
  departmentId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [areas, setAreas] = useState<AreaView[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    void api<AreaView[]>("/api/organization/areas")
      .then(setAreas)
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <label>
      所属区域（可选）
      <select value={value} disabled={!departmentId} onChange={(e) => onChange(e.target.value)}>
        <option value="">不分配区域</option>
        {areas
          ?.filter((a) => a.departmentId === departmentId)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
      {error && <span role="alert">{error}</span>}
    </label>
  );
}
