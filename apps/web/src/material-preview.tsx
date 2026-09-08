import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Preview =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "external"; url: string }
  | {
      status: "ready";
      blobUrl: string;
      filename: string;
      mime: string;
      unsupported?: boolean;
    };
function MaterialPreview({ url, onClose }: { url: string; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview>({ status: "loading" });
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}preview=true`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) {
          let message = "资料加载失败";
          try {
            const result = await response.json();
            message = result.error?.message ?? message;
          } catch {}
          throw new Error(message);
        }
        if (response.redirected) {
          const target = new URL(response.url);
          if (target.origin !== window.location.origin) {
            throw new Error("外部资料请使用资料库中的打开链接访问");
          }
        }
        if ((response.headers.get("content-type") ?? "").includes("application/json")) {
          const result = await response.json();
          if (result.ok && result.data?.kind === "link") {
            const external = new URL(result.data.url);
            if (!["http:", "https:"].includes(external.protocol))
              throw new Error("外部资料链接无效");
            if (!disposed) setPreview({ status: "external", url: external.href });
            return;
          }
          throw new Error(result.error?.message ?? "预览服务返回格式错误");
        }
        const disposition = response.headers.get("content-disposition") ?? "";
        const filename = decodeURIComponent(
          disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ??
            disposition.match(/filename="?([^";]+)/i)?.[1] ??
            "资料",
        );
        const blob = await response.blob();
        if (disposed) return;
        if (blob.size > 50 * 1024 * 1024) throw new Error("文件超过在线预览大小限制");
        const mime = blob.type.split(";")[0] ?? "";
        objectUrl = URL.createObjectURL(blob);
        const supported = [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp",
          "video/mp4",
          "audio/mpeg",
        ].includes(mime);
        if (!disposed)
          setPreview({
            status: "ready",
            blobUrl: objectUrl,
            filename,
            mime,
            unsupported: !supported,
          });
      } catch (error) {
        if (!disposed)
          setPreview({
            status: "error",
            message: error instanceof Error ? error.message : "无法打开资料",
          });
      }
    })();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escape);
    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      document.removeEventListener("keydown", escape);
    };
  }, [url, onClose]);
  return createPortal(
    <div className="preview-backdrop">
      <section role="dialog" aria-modal="true" aria-label="资料在线预览" className="preview-dialog">
        <header>
          <h2>{preview.status === "ready" ? preview.filename : "资料在线预览"}</h2>
          <button autoFocus type="button" onClick={onClose}>
            关闭预览
          </button>
        </header>
        {preview.status === "loading" ? (
          <p role="status">正在安全加载资料…</p>
        ) : preview.status === "error" ? (
          <p role="alert">{preview.message}</p>
        ) : preview.status === "external" ? (
          <p>
            <a href={preview.url} target="_blank" rel="noopener noreferrer">
              打开外部培训资料
            </a>
          </p>
        ) : (
          <>
            <a href={url}>下载原文件</a>
            {preview.unsupported ? (
              <div>
                <h3>此格式暂不支持浏览器内容预览</h3>
                <p>预览服务未返回可显示的内容，请联系管理员检查文档转换服务。</p>
              </div>
            ) : preview.mime.startsWith("image/") ? (
              <img alt={preview.filename} src={preview.blobUrl} />
            ) : preview.mime.startsWith("video/") ? (
              <video controls src={preview.blobUrl} />
            ) : preview.mime.startsWith("audio/") ? (
              <audio controls src={preview.blobUrl} />
            ) : (
              <iframe title={preview.filename} src={preview.blobUrl} />
            )}
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
export function MaterialPreviewButton({
  url,
  label = "在线预览",
}: {
  url: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [close] = useState(() => () => setOpen(false));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <MaterialPreview url={url} onClose={close} />}
    </>
  );
}
