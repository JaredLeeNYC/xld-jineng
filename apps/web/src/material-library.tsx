import { useEffect, useState, type FormEvent } from "react";
import {
  trainingTypeLabels,
  trainingTypes,
  type TrainingType,
  type TrainingMaterialView,
  type SkillView,
} from "@jineng/skill-matrix-shared";
import { MaterialPreviewButton } from "./material-preview";

type Result<T> = { ok: true; data: T } | { ok: false; error: { message: string } };
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === "string") headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "include" });
  const result = (await response.json()) as Result<T>;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
const blank = () => ({
  title: "",
  trainingType: "" as TrainingType | "",
  trainingName: "",
  description: "",
  skillIds: [] as string[],
});

export function MaterialLibrary({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; materials: TrainingMaterialView[]; skills: SkillView[] }
  >({ status: "loading" });
  const [form, setForm] = useState(blank);
  const [files, setFiles] = useState<File[]>([]);
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  async function load() {
    setState({ status: "loading" });
    try {
      const [materials, skills] = await Promise.all([
        request<TrainingMaterialView[]>(
          `/api/training-materials${canManage ? "?includeInactive=true" : ""}`,
        ),
        canManage ? request<SkillView[]>("/api/skills") : Promise.resolve([] as SkillView[]),
      ]);
      setState({ status: "ready", materials, skills });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "培训资料加载失败",
      });
    }
  }
  useEffect(() => {
    void load();
  }, [canManage]);
  function reset() {
    setForm(blank());
    setEditing(undefined);
    setFiles([]);
    setFileInputKey((key) => key + 1);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.trainingType) {
      setNotice("请选择培训类型");
      return;
    }
    if (!editing && !files.length) {
      setNotice("请选择至少一个文件");
      return;
    }
    setBusy(true);
    setNotice("");
    let completed = 0;
    try {
      const fields = { ...form, category: trainingTypeLabels[form.trainingType] };
      if (editing) {
        await request(`/api/training-materials/${editing}`, {
          method: "PATCH",
          body: JSON.stringify(fields),
        });
      } else {
        for (const file of files) {
          const body = new FormData();
          body.set("title", form.title);
          body.set("category", fields.category);
          body.set("trainingType", form.trainingType);
          body.set("trainingName", form.trainingName);
          body.set("description", form.description);
          body.set("skillIds", JSON.stringify(form.skillIds));
          body.set("file", file);
          await request("/api/training-materials/upload", { method: "POST", body });
          completed++;
        }
      }
      setNotice(editing ? "资料已更新" : `已保存 ${completed} 份资料`);
      reset();
    } catch (error) {
      // Retain only uncommitted files so retry never reuploads successful records.
      if (completed) setFiles((selected) => selected.slice(completed));
      setNotice(
        `${completed ? `已保存 ${completed} 份，剩余文件未保存。` : ""}${error instanceof Error ? error.message : "保存失败，请重试"}`,
      );
    } finally {
      setBusy(false);
      await load();
    }
  }
  async function mutate(material: TrainingMaterialView, operation: "deactivate" | "archive") {
    if (
      operation === "archive" &&
      !window.confirm("移除后不再出现在资料列表，历史记录与已分配培训的资料仍保留。确认移除？")
    )
      return;
    setBusy(true);
    try {
      await request(`/api/training-materials/${material.id}/${operation}`, { method: "POST" });
      setNotice(operation === "archive" ? "资料已移除，历史记录保留" : "资料已停用");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  function actions(material: TrainingMaterialView) {
    return (
      <>
        <MaterialPreviewButton url={`/api/training-materials/${material.id}/content`} />
        <a
          href={`/api/training-materials/${material.id}/content`}
          target="_blank"
          rel="noopener noreferrer"
        >
          查看/下载
        </a>
        {canManage && material.canManage && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(material.id);
                setFiles([]);
                setForm({
                  title: material.title,
                  trainingType: material.trainingType ?? "other",
                  trainingName: material.trainingName ?? "",
                  description: material.description ?? "",
                  skillIds: material.skillIds,
                });
              }}
            >
              编辑
            </button>
            {material.active && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void mutate(material, "deactivate")}
              >
                停用
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void mutate(material, "archive")}>
              删除（保留历史）
            </button>
          </>
        )}
      </>
    );
  }
  if (state.status === "loading")
    return (
      <section className="panel list-state-panel" role="status">
        正在加载培训资料…
      </section>
    );
  if (state.status === "error")
    return (
      <section className="panel list-state-panel" role="alert">
        <p>{state.message}</p>
        <button type="button" onClick={() => void load()}>
          重新加载
        </button>
      </section>
    );
  const materials = state.materials.filter((material) =>
    `${material.title} ${material.trainingName ?? ""} ${material.category} ${material.skills.map((skill) => skill.name).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="material-page">
      <section className="welcome">
        <div>
          <h1>{canManage ? "培训资料库" : "学习资料"}</h1>
          <p>查看培训文档、图片与视频。</p>
        </div>
      </section>
      {notice && (
        <p className="organization-notice" role="status">
          {notice}
        </p>
      )}
      {canManage && (
        <form className="panel compact-form material-form" onSubmit={(event) => void save(event)}>
          <h2>{editing ? "编辑资料" : "新增资料"}</h2>
          <label>
            资料标题
            <input
              required
              maxLength={150}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </label>
          <label>
            培训类型
            <select
              required
              value={form.trainingType}
              onChange={(event) =>
                setForm({ ...form, trainingType: event.target.value as TrainingType })
              }
            >
              <option value="">请选择类型</option>
              {trainingTypes.map((type) => (
                <option key={type} value={type}>
                  {trainingTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            培训名称（选填）
            <input
              maxLength={150}
              value={form.trainingName}
              onChange={(event) => setForm({ ...form, trainingName: event.target.value })}
            />
          </label>
          <label>
            资料说明（选填）
            <textarea
              maxLength={500}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <label>
            关联技能（多选，选填）
            <select
              multiple
              value={form.skillIds}
              onChange={(event) =>
                setForm({
                  ...form,
                  skillIds: Array.from(event.target.selectedOptions, (option) => option.value),
                })
              }
            >
              {state.skills
                .filter((skill) => skill.active)
                .map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.code} · {skill.name}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" onClick={() => setForm({ ...form, skillIds: [] })}>
            清空关联技能
          </button>
          {!editing && (
            <label>
              文件（可多选，每份不超过25MB）
              <input
                key={fileInputKey}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.mp4,.webm"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
              <span>{files.map((file) => file.name).join("、") || "尚未选择文件"}</span>
            </label>
          )}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "正在保存…" : "保存资料"}
          </button>
          {editing && (
            <button type="button" disabled={busy} onClick={reset}>
              取消编辑
            </button>
          )}
        </form>
      )}
      <section className="panel material-list">
        <div className="panel-heading">
          <h2>资料列表</h2>
          <input
            aria-label="搜索资料"
            placeholder="搜索标题、类型、培训名称或技能"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {!materials.length ? (
          <div className="list-state-panel">暂无符合条件的培训资料</div>
        ) : (
          <>
            <div className="material-table">
              <table>
                <thead>
                  <tr>
                    <th>序号</th>
                    <th>资料名称</th>
                    <th>资料说明</th>
                    <th>培训类型</th>
                    <th>培训名称</th>
                    <th>关联技能</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map((material, index) => (
                    <tr key={material.id}>
                      <td>{index + 1}</td>
                      <td>
                        <strong>{material.title}</strong>
                        <small>{material.originalFilename ?? "外部链接"}</small>
                      </td>
                      <td>{material.description || "—"}</td>
                      <td>{trainingTypeLabels[material.trainingType ?? "other"]}</td>
                      <td>{material.trainingName || "—"}</td>
                      <td>{material.skills.map((skill) => skill.name).join("、") || "未关联"}</td>
                      <td>{material.active ? "可用" : "已停用"}</td>
                      <td>{actions(material)}</td>
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
                  <p>{material.originalFilename ?? "外部链接"}</p>
                  <p>
                    {trainingTypeLabels[material.trainingType ?? "other"]} ·{" "}
                    {material.trainingName || "未填写培训名称"}
                  </p>
                  <p>{material.description || "无补充说明"}</p>
                  <p>
                    关联技能：{material.skills.map((skill) => skill.name).join("、") || "未关联"}
                  </p>
                  {actions(material)}
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
