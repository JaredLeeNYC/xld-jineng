import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, dirname, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type PreviewFile = { bytes: Uint8Array; filename: string; mimeType: string };
export class OfficePreviewError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 503 = 503,
  ) {
    super(message);
  }
}

async function removePreviewDirectory(directory: string, temporaryRoot: string) {
  const target = resolve(directory);
  if (dirname(target) !== temporaryRoot || !basename(target).startsWith("jineng-preview-")) {
    throw new Error("Unsafe preview cleanup target");
  }
  await rm(target, { recursive: true, force: true });
}

const extensions = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);
export const isOfficePreview = (filename: string) =>
  extensions.has(extname(filename).toLowerCase());
type RunConversion = (input: {
  directory: string;
  source: string;
  output: string;
  profile: string;
}) => Promise<void>;

const runLibreOffice: RunConversion = async ({ directory, source, output, profile }) => {
  const executable = process.env.LIBREOFFICE_BIN || "soffice";
  let child;
  try {
    child = Bun.spawn(
      [
        executable,
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--headless",
        "--nologo",
        "--nodefault",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        output,
        source,
      ],
      {
        cwd: directory,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      },
    );
  } catch {
    throw new OfficePreviewError(
      "OFFICE_PREVIEW_UNAVAILABLE",
      "文档预览服务未安装或不可启动，请联系管理员安装 LibreOffice",
    );
  }
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 45_000);
  try {
    const code = await child.exited;
    if (timedOut)
      throw new OfficePreviewError(
        "OFFICE_PREVIEW_TIMEOUT",
        "文档转换超时，请上传精简文档或 PDF 后重试",
      );
    if (code !== 0)
      throw new OfficePreviewError(
        "OFFICE_PREVIEW_FAILED",
        "文档无法转换，请检查是否损坏、加密或格式不受支持",
      );
  } finally {
    clearTimeout(timeout);
  }
};

export const createOfficePreviewConverter = (run: RunConversion = runLibreOffice) => {
  let active = 0;
  return async (input: PreviewFile): Promise<PreviewFile & { mimeType: "application/pdf" }> => {
    if (
      !isOfficePreview(input.filename) ||
      !input.bytes.length ||
      input.bytes.length > 25 * 1024 * 1024
    )
      throw new OfficePreviewError(
        "INVALID_OFFICE_PREVIEW",
        "仅支持 25MB 内 Word、Excel 或 PowerPoint 文档",
        400,
      );
    if (active >= 2)
      throw new OfficePreviewError("OFFICE_PREVIEW_BUSY", "文档预览服务繁忙，请稍后重试");
    active++;
    const temporaryRoot = resolve(tmpdir());
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(temporaryRoot, "jineng-preview-"));
      const source = join(directory, `source${extname(input.filename).toLowerCase()}`);
      const output = join(directory, "output");
      const profile = join(directory, "profile");
      await mkdir(output);
      await mkdir(join(profile, "user"), { recursive: true });
      await writeFile(
        join(profile, "user", "registrymodifications.xcu"),
        `<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item></oor:items>`,
      );
      await writeFile(source, input.bytes);
      await run({ directory, source, output, profile });
      const pdf = join(output, "source.pdf");
      const size = (await stat(pdf)).size;
      if (size < 5 || size > 50 * 1024 * 1024)
        throw new OfficePreviewError(
          "OFFICE_PREVIEW_OUTPUT_INVALID",
          "转换结果为空或超过在线预览限制",
        );
      const bytes = await readFile(pdf);
      if (bytes.subarray(0, 5).toString() !== "%PDF-")
        throw new OfficePreviewError("OFFICE_PREVIEW_OUTPUT_INVALID", "文档转换未生成有效 PDF");
      return {
        bytes,
        filename: `${input.filename.replace(/\.[^.]+$/, "")}.pdf`,
        mimeType: "application/pdf",
      };
    } catch (error) {
      if (error instanceof OfficePreviewError) throw error;
      throw new OfficePreviewError(
        "OFFICE_PREVIEW_FAILED",
        "文档无法转换，请检查是否损坏、加密或格式不受支持",
      );
    } finally {
      try {
        if (directory) await removePreviewDirectory(directory, temporaryRoot);
      } finally {
        active--;
      }
    }
  };
};
export const convertOfficePreview = createOfficePreviewConverter();

// Called only after the owning service has authenticated and authorized the file.
export async function authorizedPreviewResponse(request: Request, file: PreviewFile) {
  const preview = new URL(request.url).searchParams.get("preview") === "true";
  try {
    const data =
      preview && isOfficePreview(file.filename) ? await convertOfficePreview(file) : file;
    return new Response(data.bytes.slice().buffer as ArrayBuffer, {
      headers: {
        "content-type": data.mimeType,
        "content-disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(data.filename)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        "content-security-policy": "sandbox",
      },
    });
  } catch (error) {
    const failure =
      error instanceof OfficePreviewError
        ? error
        : new OfficePreviewError("OFFICE_PREVIEW_FAILED", "文档预览暂不可用");
    return Response.json(
      { ok: false, error: { code: failure.code, message: failure.message } },
      { status: failure.status, headers: { "cache-control": "private, no-store" } },
    );
  }
}
