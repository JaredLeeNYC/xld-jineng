import type {
  DepartmentView,
  EmployeeImportRow,
  EmployeeView,
  ImportRowError,
  PositionAssignmentView,
  PositionView,
} from "@jineng/skill-matrix-shared";
import type { Pool, PoolClient } from "pg";

type AuditInput = {
  actorAccountId: string;
  action: string;
  objectType: string;
  objectId: string;
  summary?: Record<string, unknown>;
};

type ImportAccountRow = EmployeeImportRow & {
  passwordHash: string;
  temporaryPassword: string;
};

const audit = async (client: Pool | PoolClient, input: AuditInput) => {
  await client.query(
    `insert into audit_logs (actor_account_id, action, object_type, object_id, summary)
     values ($1, $2, $3, $4, $5)`,
    [input.actorAccountId, input.action, input.objectType, input.objectId, input.summary ?? {}],
  );
};

const withTransaction = async <T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

export const createPostgresOrganizationRepository = (pool: Pool) => ({
  async listDepartments(includeInactive = false): Promise<DepartmentView[]> {
    const result = await pool.query<DepartmentView>(
      `select id, code, name, active
       from departments
       where active = true or $1 = true
       order by code`,
      [includeInactive],
    );
    return result.rows;
  },

  async createDepartment(input: {
    code: string;
    name: string;
    actorAccountId: string;
  }): Promise<DepartmentView> {
    return withTransaction(pool, async (client) => {
      const result = await client.query<DepartmentView>(
        `insert into departments (code, name)
         values ($1, $2)
         returning id, code, name, active`,
        [input.code, input.name],
      );
      const department = result.rows[0]!;
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "department.created",
        objectType: "department",
        objectId: department.id,
        summary: { code: department.code, name: department.name },
      });
      return department;
    });
  },

  async updateDepartment(input: {
    id: string;
    name: string;
    actorAccountId: string;
  }): Promise<DepartmentView | undefined> {
    return withTransaction(pool, async (client) => {
      const result = await client.query<DepartmentView>(
        `update departments set name = $2, updated_at = now()
         where id = $1 returning id, code, name, active`,
        [input.id, input.name],
      );
      const department = result.rows[0];
      if (!department) return undefined;
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "department.updated",
        objectType: "department",
        objectId: department.id,
        summary: { name: department.name },
      });
      return department;
    });
  },

  async deactivateDepartment(input: { id: string; actorAccountId: string }): Promise<boolean> {
    return withTransaction(pool, async (client) => {
      const result = await client.query(
        `update departments set active = false, updated_at = now()
         where id = $1 and active = true returning id`,
        [input.id],
      );
      if (result.rowCount === 0) return false;
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "department.deactivated",
        objectType: "department",
        objectId: input.id,
      });
      return true;
    });
  },

  async listPositions(input: {
    departmentId?: string;
    includeInactive?: boolean;
  }): Promise<PositionView[]> {
    const result = await pool.query<PositionView>(
      `select p.id, p.code, p.name,
              p.department_id as "departmentId",
              d.name as "departmentName", p.active
       from positions p
       join departments d on d.id = p.department_id
       where ($1::uuid is null or p.department_id = $1)
         and (p.active = true or $2 = true)
       order by p.code`,
      [input.departmentId ?? null, input.includeInactive ?? false],
    );
    return result.rows;
  },

  async createPosition(input: {
    code: string;
    name: string;
    departmentId: string;
    actorAccountId: string;
  }): Promise<PositionView | undefined> {
    return withTransaction(pool, async (client) => {
      const result = await client.query<PositionView>(
        `insert into positions (code, name, department_id)
         select $1, $2, id from departments where id = $3 and active = true
         returning id, code, name, department_id as "departmentId", '' as "departmentName", active`,
        [input.code, input.name, input.departmentId],
      );
      const position = result.rows[0];
      if (!position) return undefined;
      const department = await client.query<{ name: string }>(
        "select name from departments where id = $1",
        [position.departmentId],
      );
      position.departmentName = department.rows[0]!.name;
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "position.created",
        objectType: "position",
        objectId: position.id,
        summary: { code: position.code, departmentId: position.departmentId },
      });
      return position;
    });
  },

  async updatePosition(input: {
    id: string;
    name: string;
    departmentId: string;
    actorAccountId: string;
  }): Promise<boolean> {
    return withTransaction(pool, async (client) => {
      const result = await client.query(
        `update positions p set name = $2, department_id = $3, updated_at = now()
         where p.id = $1 and exists (
           select 1 from departments d where d.id = $3 and d.active = true
         ) returning p.id`,
        [input.id, input.name, input.departmentId],
      );
      if (result.rowCount === 0) return false;
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "position.updated",
        objectType: "position",
        objectId: input.id,
        summary: { name: input.name, departmentId: input.departmentId },
      });
      return true;
    });
  },

  async deactivatePosition(input: { id: string; actorAccountId: string }): Promise<boolean> {
    return withTransaction(pool, async (client) => {
      const result = await client.query(
        "update positions set active = false, updated_at = now() where id = $1 and active = true returning id",
        [input.id],
      );
      if (result.rowCount === 0) return false;
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "position.deactivated",
        objectType: "position",
        objectId: input.id,
      });
      return true;
    });
  },

  async listEmployees(input: {
    departmentId?: string;
    employeeId?: string;
    active?: boolean;
    query?: string;
  }): Promise<EmployeeView[]> {
    const result = await pool.query<
      Omit<
        EmployeeView,
        "departmentId" | "departmentName" | "positionId" | "positionName" | "hireDate" | "phone"
      > & {
        departmentId: string | null;
        departmentName: string | null;
        positionId: string | null;
        positionName: string | null;
        hireDate: string | null;
        phone: string | null;
      }
    >(
      `select e.id, e.employee_number as "employeeNumber", e.display_name as "displayName",
              e.department_id as "departmentId", d.name as "departmentName",
              pa.position_id as "positionId", p.name as "positionName",
              e.hire_date::text as "hireDate", e.phone, a.role,
              (e.active and a.active) as active
       from employees e
       join user_accounts a on a.employee_id = e.id
       left join departments d on d.id = e.department_id
       left join position_assignments pa on pa.employee_id = e.id and pa.ended_at is null
       left join positions p on p.id = pa.position_id
       where ($1::uuid is null or e.department_id = $1)
         and ($2::uuid is null or e.id = $2)
         and ($3::boolean is null or (e.active and a.active) = $3)
         and ($4::text is null or e.employee_number ilike '%' || $4 || '%' or e.display_name ilike '%' || $4 || '%')
       order by e.employee_number`,
      [
        input.departmentId ?? null,
        input.employeeId ?? null,
        input.active ?? null,
        input.query ?? null,
      ],
    );
    return result.rows.map((row) => ({
      id: row.id,
      employeeNumber: row.employeeNumber,
      displayName: row.displayName,
      role: row.role,
      active: row.active,
      ...(row.departmentId ? { departmentId: row.departmentId } : {}),
      ...(row.departmentName ? { departmentName: row.departmentName } : {}),
      ...(row.positionId ? { positionId: row.positionId } : {}),
      ...(row.positionName ? { positionName: row.positionName } : {}),
      ...(row.hireDate ? { hireDate: row.hireDate } : {}),
      ...(row.phone ? { phone: row.phone } : {}),
    }));
  },

  async listAssignments(employeeId: string): Promise<PositionAssignmentView[]> {
    const result = await pool.query<PositionAssignmentView>(
      `select pa.id, pa.department_id as "departmentId", d.name as "departmentName",
              pa.position_id as "positionId", p.name as "positionName",
              pa.started_at::text as "startedAt", pa.ended_at::text as "endedAt", pa.reason
       from position_assignments pa
       join departments d on d.id = pa.department_id
       join positions p on p.id = pa.position_id
       where pa.employee_id = $1 order by pa.started_at desc`,
      [employeeId],
    );
    return result.rows.map((row) => ({
      ...row,
      ...(row.endedAt ? { endedAt: row.endedAt } : {}),
    }));
  },

  async updateEmployee(input: {
    id: string;
    displayName: string;
    hireDate?: string;
    phone?: string;
    actorAccountId: string;
  }): Promise<boolean> {
    return withTransaction(pool, async (client) => {
      const result = await client.query(
        `update employees set display_name = $2, hire_date = $3, phone = $4, updated_at = now()
         where id = $1 returning id`,
        [input.id, input.displayName, input.hireDate ?? null, input.phone ?? null],
      );
      if (result.rowCount === 0) return false;
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "employee.updated",
        objectType: "employee",
        objectId: input.id,
        summary: {
          displayName: input.displayName,
          hireDate: input.hireDate,
          phone: input.phone,
        },
      });
      return true;
    });
  },

  async changeAssignment(input: {
    employeeId: string;
    departmentId: string;
    positionId: string;
    reason: string;
    effectiveAt: Date;
    actorAccountId: string;
  }): Promise<boolean> {
    return withTransaction(pool, async (client) => {
      const target = await client.query(
        `select p.id from positions p join departments d on d.id = p.department_id
         where p.id = $1 and p.department_id = $2 and p.active = true and d.active = true`,
        [input.positionId, input.departmentId],
      );
      if (target.rowCount === 0) return false;
      await client.query(
        `update position_assignments set ended_at = $2, updated_at = now()
         where employee_id = $1 and ended_at is null`,
        [input.employeeId, input.effectiveAt],
      );
      const created = await client.query<{ id: string }>(
        `insert into position_assignments (
           employee_id, department_id, position_id, started_at, reason
         ) select id, $2, $3, $4, $5 from employees where id = $1 and active = true
         returning id`,
        [input.employeeId, input.departmentId, input.positionId, input.effectiveAt, input.reason],
      );
      if (created.rowCount === 0) return false;
      await client.query(
        "update employees set department_id = $2, updated_at = now() where id = $1",
        [input.employeeId, input.departmentId],
      );
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "employee.assignment_changed",
        objectType: "employee",
        objectId: input.employeeId,
        summary: {
          departmentId: input.departmentId,
          positionId: input.positionId,
          reason: input.reason,
        },
      });
      return true;
    });
  },

  async deactivateEmployee(input: { id: string; actorAccountId: string }): Promise<boolean> {
    return withTransaction(pool, async (client) => {
      const result = await client.query(
        `update employees set active = false, updated_at = now()
         where id = $1 and active = true returning id`,
        [input.id],
      );
      if (result.rowCount === 0) return false;
      await client.query(
        `update user_accounts set active = false, session_version = session_version + 1, updated_at = now()
         where employee_id = $1`,
        [input.id],
      );
      await client.query(
        "update position_assignments set ended_at = now(), updated_at = now() where employee_id = $1 and ended_at is null",
        [input.id],
      );
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "employee.deactivated",
        objectType: "employee",
        objectId: input.id,
      });
      return true;
    });
  },

  async findImportReferences() {
    const [departments, positions, employees] = await Promise.all([
      pool.query<{ id: string; code: string }>(
        "select id, code from departments where active = true",
      ),
      pool.query<{ id: string; code: string; departmentId: string }>(
        `select id, code, department_id as "departmentId" from positions where active = true`,
      ),
      pool.query<{ employeeNumber: string }>(
        `select employee_number as "employeeNumber" from employees`,
      ),
    ]);
    return {
      departments: departments.rows,
      positions: positions.rows,
      employeeNumbers: employees.rows.map((row) => row.employeeNumber),
    };
  },

  async storeImportPreview(input: {
    id: string;
    actorAccountId: string;
    rows: EmployeeImportRow[];
    errors: ImportRowError[];
    expiresAt: Date;
  }) {
    await pool.query(
      `insert into import_previews (id, actor_account_id, rows, errors, expires_at)
       values ($1, $2, $3, $4, $5)`,
      [
        input.id,
        input.actorAccountId,
        JSON.stringify(input.rows),
        JSON.stringify(input.errors),
        input.expiresAt,
      ],
    );
  },

  async loadImportPreview(id: string, actorAccountId: string) {
    const result = await pool.query<{
      rows: EmployeeImportRow[];
      errors: ImportRowError[];
      expiresAt: Date;
      confirmedAt: Date | null;
    }>(
      `select rows, errors, expires_at as "expiresAt", confirmed_at as "confirmedAt"
       from import_previews where id = $1 and actor_account_id = $2`,
      [id, actorAccountId],
    );
    return result.rows[0];
  },

  async confirmImport(input: {
    previewId: string;
    actorAccountId: string;
    rows: ImportAccountRow[];
    now: Date;
  }) {
    return withTransaction(pool, async (client) => {
      const claimed = await client.query(
        `update import_previews set confirmed_at = $3
         where id = $1 and actor_account_id = $2 and confirmed_at is null and expires_at > $3
         returning id`,
        [input.previewId, input.actorAccountId, input.now],
      );
      if (claimed.rowCount === 0) return undefined;
      const credentials: Array<{ employeeNumber: string; temporaryPassword: string }> = [];
      for (const row of input.rows) {
        const reference = await client.query<{ departmentId: string; positionId: string }>(
          `select d.id as "departmentId", p.id as "positionId"
           from departments d join positions p on p.department_id = d.id
           where d.code = $1 and p.code = $2 and d.active = true and p.active = true`,
          [row.departmentCode, row.positionCode],
        );
        const target = reference.rows[0];
        if (!target) throw new Error(`IMPORT_REFERENCE_CHANGED:${row.rowNumber}`);
        const employee = await client.query<{ id: string }>(
          `insert into employees (
             employee_number, display_name, department_id, hire_date, phone
           ) values ($1, $2, $3, $4, $5) returning id`,
          [
            row.employeeNumber,
            row.displayName,
            target.departmentId,
            row.hireDate ?? null,
            row.phone ?? null,
          ],
        );
        await client.query(
          `insert into user_accounts (employee_id, password_hash, role, must_change_password)
           values ($1, $2, 'employee', true)`,
          [employee.rows[0]!.id, row.passwordHash],
        );
        await client.query(
          `insert into position_assignments (
             employee_id, department_id, position_id, started_at, reason
           ) values ($1, $2, $3, $4, 'Excel 初始导入')`,
          [employee.rows[0]!.id, target.departmentId, target.positionId, input.now],
        );
        credentials.push({
          employeeNumber: row.employeeNumber,
          temporaryPassword: row.temporaryPassword,
        });
      }
      await audit(client, {
        actorAccountId: input.actorAccountId,
        action: "employees.imported",
        objectType: "import_preview",
        objectId: input.previewId,
        summary: { imported: input.rows.length },
      });
      return credentials;
    });
  },

  async recordExport(input: {
    actorAccountId: string;
    rowCount: number;
    filters: Record<string, unknown>;
  }) {
    await audit(pool, {
      actorAccountId: input.actorAccountId,
      action: "employees.exported",
      objectType: "employee_export",
      objectId: crypto.randomUUID(),
      summary: { rowCount: input.rowCount, filters: input.filters },
    });
  },
});

export type OrganizationRepository = ReturnType<typeof createPostgresOrganizationRepository>;
