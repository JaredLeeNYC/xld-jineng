import { useState } from "react";

export function EmployeePhoto({ name, photoUrl }: { name: string; photoUrl?: string | undefined }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <span className="employee-photo" aria-label={`${name}的照片`} role="img">
      {photoUrl && failedUrl !== photoUrl ? (
        <img src={photoUrl} alt="" onError={() => setFailedUrl(photoUrl)} />
      ) : (
        <span aria-hidden="true">{Array.from(name.trim()).slice(0, 1).join("") || "—"}</span>
      )}
    </span>
  );
}

export function EmployeePhotoMaintenance({
  employee,
  onSaved,
}: {
  employee: { id: string; displayName: string; photoUrl?: string };
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (file?: File) => {
    if (busy) return;
    setError("");
    if (
      file &&
      (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 1024 * 1024)
    ) {
      setError("请选择不超过 1 MiB 的 PNG、JPEG 或 WebP 照片");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      if (file) body.append("file", file);
      const response = await fetch(`/api/organization/employees/${employee.id}/photo`, {
        method: file ? "PUT" : "DELETE",
        credentials: "include",
        ...(file ? { body } : {}),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "照片保存失败");
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "照片保存失败，请重试");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="employee-photo-maintenance">
      <label>
        {employee.photoUrl ? "替换照片" : "上传照片"}（PNG / JPEG / WebP，≤1 MiB）
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={`${employee.displayName}：${employee.photoUrl ? "替换" : "上传"}照片`}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void save(file);
          }}
        />
      </label>
      {employee.photoUrl && (
        <button type="button" disabled={busy} onClick={() => void save()}>
          移除照片
        </button>
      )}
      {busy && <p role="status">正在保存照片…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
