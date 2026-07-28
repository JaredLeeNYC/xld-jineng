import type { OrganizationRepository } from "@jineng/skill-matrix-db";
import {
  normalizeBusinessCode,
  type EmployeeImportRow,
  type ImportRowError,
} from "@jineng/skill-matrix-shared";
import type { SessionView } from "./auth-contract";

type OrganizationFailure = {
  ok: false;
  error: { code: string; message: string; status: 400 | 403 | 404 | 409 };
};

type OrganizationResult<T> = { ok: true; data: T } | OrganizationFailure;

const failure = (
  code: string,
  message: string,
  status: OrganizationFailure["error"]["status"],
): OrganizationFailure => ({ ok: false, error: { code, message, status } });

const requireHr = (actor: SessionView): OrganizationFailure | undefined =>
  actor.role === "hr_admin" ? undefined : failure("FORBIDDEN", "仅 HR 可以维护组织人员", 403);

const validateName = (value: string) => value.trim().length >= 1 && value.trim().length <= 100;

const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const validateImportRows = async (
  repository: OrganizationRepository,
  inputRows: EmployeeImportRow[],
): Promise<{ rows: EmployeeImportRow[]; errors: ImportRowError[] }> => {
  const references = await repository.findImportReferences();
  const departments = new Map(references.departments.map((item) => [item.code, item.id]));
  const positions = new Map(references.positions.map((item) => [item.code, item]));
  const existingNumbers = new Set(references.employeeNumbers);
  const batchNumbers = new Set<string>();
  const rows = inputRows.map((row) => ({
    ...row,
    employeeNumber: normalizeBusinessCode(row.employeeNumber),
    displayName: row.displayName.trim(),
    departmentCode: normalizeBusinessCode(row.departmentCode),
    positionCode: normalizeBusinessCode(row.positionCode),
    ...(row.phone ? { phone: row.phone.trim() } : {}),
  }));
  const errors: ImportRowError[] = [];
  for (const row of rows) {
    for (const [field, value, label] of [
      ["employeeNumber", row.employeeNumber, "工号"],
      ["displayName", row.displayName, "姓名"],
      ["departmentCode", row.departmentCode, "部门编码"],
      ["positionCode", row.positionCode, "岗位编码"],
    ] as const) {
      if (!value) {
        errors.push({
          rowNumber: row.rowNumber,
          field,
          code: "REQUIRED",
          message: `${label}不能为空`,
        });
      }
    }
    if (row.employeeNumber) {
      if (existingNumbers.has(row.employeeNumber) || batchNumbers.has(row.employeeNumber)) {
        errors.push({
          rowNumber: row.rowNumber,
          field: "employeeNumber",
          code: "DUPLICATE",
          message: "工号已存在或在文件中重复",
        });
      }
      batchNumbers.add(row.employeeNumber);
    }
    const departmentId = departments.get(row.departmentCode);
    if (row.departmentCode && !departmentId) {
      errors.push({
        rowNumber: row.rowNumber,
        field: "departmentCode",
        code: "INVALID_DEPARTMENT",
        message: "部门编码不存在或已停用",
      });
    }
    const position = positions.get(row.positionCode);
    if (row.positionCode && (!position || position.departmentId !== departmentId)) {
      errors.push({
        rowNumber: row.rowNumber,
        field: "positionCode",
        code: "INVALID_POSITION",
        message: "岗位编码不存在、已停用或不属于所选部门",
      });
    }
    if (row.hireDate && !isIsoDate(row.hireDate)) {
      errors.push({
        rowNumber: row.rowNumber,
        field: "hireDate",
        code: "INVALID_VALUE",
        message: "入职日期必须为 YYYY-MM-DD",
      });
    }
  }
  return { rows, errors };
};

export const createOrganizationService = (dependencies: {
  repository: OrganizationRepository;
  passwordHash: (value: string) => Promise<string>;
  temporaryPassword: () => string;
  idSource: () => string;
  now: () => Date;
}) => {
  const { repository, passwordHash, temporaryPassword, idSource, now } = dependencies;
  return {
    async listDepartments(actor: SessionView, includeInactive = false) {
      if (
        !["hr_admin", "department_manager", "executive_viewer", "employee"].includes(actor.role)
      ) {
        return failure("FORBIDDEN", "无权查看组织数据", 403);
      }
      if (
        (actor.role === "department_manager" || actor.role === "employee") &&
        !actor.departmentId
      ) {
        return failure("FORBIDDEN", "账号未关联有效部门", 403);
      }
      const departments = await repository.listDepartments(
        actor.role === "hr_admin" ? includeInactive : false,
      );
      return {
        ok: true as const,
        data:
          actor.role === "department_manager" || actor.role === "employee"
            ? departments.filter((item) => item.id === actor.departmentId)
            : departments,
      };
    },

    async createDepartment(actor: SessionView, input: { code: string; name: string }) {
      const denied = requireHr(actor);
      if (denied) return denied;
      const code = normalizeBusinessCode(input.code);
      if (!code || !validateName(input.name)) {
        return failure("INVALID_DEPARTMENT", "部门编码和名称不能为空", 400);
      }
      try {
        return {
          ok: true as const,
          data: await repository.createDepartment({
            code,
            name: input.name.trim(),
            actorAccountId: actor.accountId,
          }),
        };
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "23505") {
          return failure("DUPLICATE_DEPARTMENT_CODE", "部门编码已存在", 409);
        }
        throw error;
      }
    },

    async updateDepartment(actor: SessionView, id: string, input: { name: string }) {
      const denied = requireHr(actor);
      if (denied) return denied;
      if (!validateName(input.name)) return failure("INVALID_DEPARTMENT", "部门名称不能为空", 400);
      const department = await repository.updateDepartment({
        id,
        name: input.name.trim(),
        actorAccountId: actor.accountId,
      });
      return department
        ? { ok: true as const, data: department }
        : failure("DEPARTMENT_NOT_FOUND", "部门不存在", 404);
    },

    async deactivateDepartment(actor: SessionView, id: string) {
      const denied = requireHr(actor);
      if (denied) return denied;
      return (await repository.deactivateDepartment({ id, actorAccountId: actor.accountId }))
        ? { ok: true as const, data: { id, active: false as const } }
        : failure("DEPARTMENT_NOT_FOUND", "部门不存在或已停用", 404);
    },

    async listPositions(actor: SessionView, includeInactive = false) {
      if (
        !["hr_admin", "department_manager", "executive_viewer", "employee"].includes(actor.role)
      ) {
        return failure("FORBIDDEN", "无权查看岗位", 403);
      }
      if (
        (actor.role === "department_manager" || actor.role === "employee") &&
        !actor.departmentId
      ) {
        return failure("FORBIDDEN", "账号未关联有效部门", 403);
      }
      return {
        ok: true as const,
        data: await repository.listPositions({
          ...(actor.role === "department_manager" || actor.role === "employee"
            ? { departmentId: actor.departmentId }
            : {}),
          includeInactive: actor.role === "hr_admin" && includeInactive,
        }),
      };
    },

    async createPosition(
      actor: SessionView,
      input: { code: string; name: string; departmentId: string },
    ) {
      const denied = requireHr(actor);
      if (denied) return denied;
      const code = normalizeBusinessCode(input.code);
      if (!code || !validateName(input.name)) {
        return failure("INVALID_POSITION", "岗位编码和名称不能为空", 400);
      }
      try {
        const position = await repository.createPosition({
          code,
          name: input.name.trim(),
          departmentId: input.departmentId,
          actorAccountId: actor.accountId,
        });
        return position
          ? { ok: true as const, data: position }
          : failure("INVALID_DEPARTMENT", "部门不存在或已停用", 409);
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "23505") {
          return failure("DUPLICATE_POSITION_CODE", "岗位编码已存在", 409);
        }
        throw error;
      }
    },

    async updatePosition(
      actor: SessionView,
      id: string,
      input: { name: string; departmentId: string },
    ) {
      const denied = requireHr(actor);
      if (denied) return denied;
      if (!validateName(input.name)) return failure("INVALID_POSITION", "岗位名称不能为空", 400);
      return (await repository.updatePosition({
        id,
        name: input.name.trim(),
        departmentId: input.departmentId,
        actorAccountId: actor.accountId,
      }))
        ? { ok: true as const, data: { id } }
        : failure("POSITION_NOT_FOUND", "岗位或部门不存在", 404);
    },

    async deactivatePosition(actor: SessionView, id: string) {
      const denied = requireHr(actor);
      if (denied) return denied;
      return (await repository.deactivatePosition({ id, actorAccountId: actor.accountId }))
        ? { ok: true as const, data: { id, active: false as const } }
        : failure("POSITION_NOT_FOUND", "岗位不存在或已停用", 404);
    },

    async listEmployees(
      actor: SessionView,
      filters: { active?: boolean; query?: string } = {},
    ): Promise<OrganizationResult<Awaited<ReturnType<OrganizationRepository["listEmployees"]>>>> {
      if (actor.role === "system_admin") return failure("FORBIDDEN", "无权查看业务人员", 403);
      if (actor.role === "department_manager" && !actor.departmentId) {
        return failure("FORBIDDEN", "主管账号未关联有效部门", 403);
      }
      return {
        ok: true,
        data: await repository.listEmployees({
          ...filters,
          ...(actor.role === "department_manager" ? { departmentId: actor.departmentId } : {}),
          ...(actor.role === "employee" ? { employeeId: actor.employeeId } : {}),
        }),
      };
    },

    async listAssignments(actor: SessionView, employeeId: string) {
      const employees = await this.listEmployees(actor);
      if (!employees.ok) return employees;
      if (!employees.data.some((employee) => employee.id === employeeId)) {
        return failure("FORBIDDEN", "无权查看该员工岗位履历", 403);
      }
      return { ok: true as const, data: await repository.listAssignments(employeeId) };
    },

    async createEmployee(actor: SessionView, input: Omit<EmployeeImportRow, "rowNumber">) {
      const denied = requireHr(actor);
      if (denied) return denied;
      const preview = await this.dryRunImport(actor, [{ ...input, rowNumber: 1 }]);
      if (!preview.ok) return preview;
      if (preview.data.errors.length > 0) {
        return failure("INVALID_EMPLOYEE", preview.data.errors[0]!.message, 409);
      }
      return this.confirmImport(actor, preview.data.previewId);
    },

    async updateEmployee(
      actor: SessionView,
      employeeId: string,
      input: { displayName: string; hireDate?: string; phone?: string },
    ) {
      const denied = requireHr(actor);
      if (denied) return denied;
      if (!validateName(input.displayName)) {
        return failure("INVALID_EMPLOYEE", "员工姓名不能为空", 400);
      }
      if (input.hireDate && !isIsoDate(input.hireDate)) {
        return failure("INVALID_EMPLOYEE", "入职日期必须为 YYYY-MM-DD", 400);
      }
      return (await repository.updateEmployee({
        id: employeeId,
        displayName: input.displayName.trim(),
        ...(input.hireDate ? { hireDate: input.hireDate } : {}),
        ...(input.phone ? { phone: input.phone.trim() } : {}),
        actorAccountId: actor.accountId,
      }))
        ? { ok: true as const, data: { id: employeeId } }
        : failure("EMPLOYEE_NOT_FOUND", "员工不存在", 404);
    },

    async changeAssignment(
      actor: SessionView,
      employeeId: string,
      input: { departmentId: string; positionId: string; reason: string; effectiveAt?: string },
    ) {
      const denied = requireHr(actor);
      if (denied) return denied;
      if (!input.reason.trim()) return failure("REASON_REQUIRED", "岗位变更原因不能为空", 400);
      const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : now();
      if (Number.isNaN(effectiveAt.getTime()) || effectiveAt > now()) {
        return failure("INVALID_EFFECTIVE_AT", "岗位生效时间无效或晚于当前时间", 400);
      }
      const changed = await repository.changeAssignment({
        employeeId,
        departmentId: input.departmentId,
        positionId: input.positionId,
        reason: input.reason.trim(),
        effectiveAt,
        actorAccountId: actor.accountId,
      });
      return changed
        ? { ok: true as const, data: { employeeId } }
        : failure("INVALID_ASSIGNMENT", "员工、部门或岗位无效", 409);
    },

    async deactivateEmployee(actor: SessionView, employeeId: string) {
      const denied = requireHr(actor);
      if (denied) return denied;
      return (await repository.deactivateEmployee({
        id: employeeId,
        actorAccountId: actor.accountId,
      }))
        ? { ok: true as const, data: { id: employeeId, active: false as const } }
        : failure("EMPLOYEE_NOT_FOUND", "员工不存在或已停用", 404);
    },

    async dryRunImport(actor: SessionView, inputRows: EmployeeImportRow[]) {
      const denied = requireHr(actor);
      if (denied) return denied;
      if (inputRows.length === 0 || inputRows.length > 2_000) {
        return failure("INVALID_IMPORT_SIZE", "导入文件应包含 1-2000 行员工数据", 400);
      }
      const { rows, errors } = await validateImportRows(repository, inputRows);
      const previewId = idSource();
      const expiresAt = new Date(now().getTime() + 30 * 60 * 1000);
      await repository.storeImportPreview({
        id: previewId,
        actorAccountId: actor.accountId,
        rows,
        errors,
        expiresAt,
      });
      return {
        ok: true as const,
        data: {
          previewId,
          totalRows: rows.length,
          validRows: rows.length - new Set(errors.map((error) => error.rowNumber)).size,
          errors,
          expiresAt: expiresAt.toISOString(),
        },
      };
    },

    async confirmImport(actor: SessionView, previewId: string) {
      const denied = requireHr(actor);
      if (denied) return denied;
      const preview = await repository.loadImportPreview(previewId, actor.accountId);
      if (!preview || preview.expiresAt <= now() || preview.confirmedAt) {
        return failure("IMPORT_PREVIEW_EXPIRED", "预检不存在、已过期或已确认", 409);
      }
      if (preview.errors.length > 0) {
        return failure("IMPORT_HAS_ERRORS", "请修正全部预检错误后重新上传", 409);
      }
      const rows = [];
      for (const row of preview.rows) {
        const password = temporaryPassword();
        rows.push({
          ...row,
          temporaryPassword: password,
          passwordHash: await passwordHash(password),
        });
      }
      try {
        const credentials = await repository.confirmImport({
          previewId,
          actorAccountId: actor.accountId,
          rows,
          now: now(),
        });
        return credentials
          ? { ok: true as const, data: { imported: credentials.length, credentials } }
          : failure("IMPORT_PREVIEW_EXPIRED", "预检不存在、已过期或已确认", 409);
      } catch (error) {
        if (
          (typeof error === "object" && error && "code" in error && error.code === "23505") ||
          String(error).includes("IMPORT_REFERENCE_CHANGED")
        ) {
          return failure("IMPORT_CONFLICT", "组织数据已变化，请重新预检", 409);
        }
        throw error;
      }
    },

    async exportEmployees(actor: SessionView, filters: { active?: boolean; query?: string }) {
      const employees = await this.listEmployees(actor, filters);
      if (!employees.ok) return employees;
      if (!["hr_admin", "executive_viewer", "department_manager"].includes(actor.role)) {
        return failure("FORBIDDEN", "无权导出组织人员", 403);
      }
      await repository.recordExport({
        actorAccountId: actor.accountId,
        rowCount: employees.data.length,
        filters,
      });
      return employees;
    },
  };
};

export type OrganizationService = ReturnType<typeof createOrganizationService>;
