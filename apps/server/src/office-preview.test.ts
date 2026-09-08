import { describe, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  authorizedPreviewResponse,
  createOfficePreviewConverter,
  OfficePreviewError,
} from "./office-preview";

const failureOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to fail");
};

const source = (filename = "培训.docx") => ({
  bytes: new Uint8Array([1, 2, 3]),
  filename,
  mimeType: "application/octet-stream",
});
const pdf = new TextEncoder().encode("%PDF-1.7\nfixture");

describe("Office PDF preview conversion", () => {
  test("uses isolated generated paths for all six formats and cleans successful work", async () => {
    const directories: string[] = [];
    const convert = createOfficePreviewConverter(
      async ({ directory, source: input, output, profile }) => {
        directories.push(directory);
        expect(basename(input)).toMatch(/^source\.(doc|docx|ppt|pptx|xls|xlsx)$/);
        expect([...(await readFile(input))]).toEqual([1, 2, 3]);
        expect(
          await readFile(join(profile, "user", "registrymodifications.xcu"), "utf8"),
        ).toContain("MacroSecurityLevel");
        await writeFile(join(output, "source.pdf"), pdf);
      },
    );
    for (const extension of ["doc", "docx", "ppt", "pptx", "xls", "xlsx"]) {
      const converted = await convert(source(`../../不可信文件名.${extension}`));
      expect(converted.mimeType).toBe("application/pdf");
      expect([...converted.bytes]).toEqual([...pdf]);
    }
    expect(new Set(directories).size).toBe(6);
    for (const directory of directories)
      expect(await failureOf(stat(directory))).toBeInstanceOf(Error);
  });

  test("rejects unsupported and oversized inputs before invoking the converter", async () => {
    let called = false;
    const convert = createOfficePreviewConverter(async () => {
      called = true;
    });
    expect(await failureOf(convert(source("script.html")))).toMatchObject({
      code: "INVALID_OFFICE_PREVIEW",
      status: 400,
    });
    expect(
      await failureOf(convert({ ...source(), bytes: new Uint8Array(25 * 1024 * 1024 + 1) })),
    ).toMatchObject({ code: "INVALID_OFFICE_PREVIEW" });
    expect(called).toBe(false);
  });

  test("cleans failed work and preserves actionable unavailable or timeout errors", async () => {
    for (const code of ["OFFICE_PREVIEW_UNAVAILABLE", "OFFICE_PREVIEW_TIMEOUT"]) {
      let directory = "";
      const convert = createOfficePreviewConverter(async (input) => {
        directory = input.directory;
        throw new OfficePreviewError(code, "预览不可用");
      });
      expect(await failureOf(convert(source()))).toMatchObject({ code });
      expect(await failureOf(stat(directory))).toBeInstanceOf(Error);
    }
  });

  test("rejects non-PDF output and removes the temporary document", async () => {
    let directory = "";
    const convert = createOfficePreviewConverter(async (input) => {
      directory = input.directory;
      await writeFile(join(input.output, "source.pdf"), "<script>bad output</script>");
    });
    expect(await failureOf(convert(source()))).toMatchObject({
      code: "OFFICE_PREVIEW_OUTPUT_INVALID",
    });
    expect(await failureOf(stat(directory))).toBeInstanceOf(Error);
  });

  test("limits conversion concurrency and releases slots after failure", async () => {
    let release = () => {};
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const convert = createOfficePreviewConverter(async () => {
      await blocker;
      throw new Error("failure");
    });
    const first = convert(source()).catch(() => undefined);
    const second = convert(source()).catch(() => undefined);
    expect(await failureOf(convert(source()))).toMatchObject({ code: "OFFICE_PREVIEW_BUSY" });
    release();
    await Promise.all([first, second]);
    expect(await failureOf(convert(source()))).toMatchObject({ code: "OFFICE_PREVIEW_FAILED" });
  });

  test("keeps downloads original and serves authorized PDF preview inline without caching", async () => {
    const file = { bytes: pdf, filename: "证据.pdf", mimeType: "application/pdf" };
    const download = await authorizedPreviewResponse(new Request("http://localhost/content"), file);
    const preview = await authorizedPreviewResponse(
      new Request("http://localhost/content?preview=true"),
      file,
    );
    expect(download.headers.get("content-disposition")).toStartWith("attachment;");
    expect(preview.headers.get("content-disposition")).toStartWith("inline;");
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
    expect(preview.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(pdf);
  });
});
