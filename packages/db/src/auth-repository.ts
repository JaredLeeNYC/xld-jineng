import type { FixedRole } from "@jineng/skill-matrix-shared";
import type { Pool, PoolClient } from "pg";

type AuthAccount = {
  id: string;
  employeeId: string;
  employeeNumber: string;
  displayName: string;
  departmentId?: string;
  role: FixedRole;
  passwordHash: string;
  mustChangePassword: boolean;
  active: boolean;
  sessionVersion: number;
};

type StoredSession = {
  id: string;
  accountId: string;
  tokenHash: string;
  sessionVersion: number;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date;
};

type SecurityEventInput = {
  type: string;
  accountId?: string;
  identifierHash?: string;
  ipAddress?: string;
  userAgent?: string;
  detail?: Record<string, unknown>;
};

type Queryable = Pick<Pool | PoolClient, "query">;

const insertSecurityEvent = async (
  queryable: Queryable,
  input: SecurityEventInput,
): Promise<void> => {
  await queryable.query(
    `insert into security_events (
       type, account_id, identifier_hash, ip_address, user_agent, detail
     ) values ($1, $2, $3, $4, $5, $6)`,
    [
      input.type,
      input.accountId ?? null,
      input.identifierHash ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.detail ?? {},
    ],
  );
};

type AccountRow = {
  id: string;
  employeeId: string;
  employeeNumber: string;
  displayName: string;
  departmentId: string | null;
  role: FixedRole;
  passwordHash: string;
  mustChangePassword: boolean;
  active: boolean;
  employeeActive: boolean;
  sessionVersion: number;
};

const accountFromRow = (row: AccountRow): AuthAccount => ({
  id: row.id,
  employeeId: row.employeeId,
  employeeNumber: row.employeeNumber,
  displayName: row.displayName,
  ...(row.departmentId ? { departmentId: row.departmentId } : {}),
  role: row.role,
  passwordHash: row.passwordHash,
  mustChangePassword: row.mustChangePassword,
  active: row.active && row.employeeActive,
  sessionVersion: row.sessionVersion,
});

const accountSelection = `
  select
    a.id,
    a.employee_id as "employeeId",
    e.employee_number as "employeeNumber",
    e.display_name as "displayName",
    e.department_id as "departmentId",
    a.role,
    a.password_hash as "passwordHash",
    a.must_change_password as "mustChangePassword",
    a.active,
    e.active as "employeeActive",
    a.session_version as "sessionVersion"
  from user_accounts a
  join employees e on e.id = a.employee_id
`;

const withTransaction = async <T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> => {
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

export const createPostgresAuthRepository = (pool: Pool) => ({
  async findAccountByEmployeeNumber(employeeNumber: string): Promise<AuthAccount | undefined> {
    const result = await pool.query<AccountRow>(
      `${accountSelection} where upper(trim(e.employee_number)) = $1`,
      [employeeNumber],
    );
    return result.rows[0] ? accountFromRow(result.rows[0]) : undefined;
  },

  async findAccountById(accountId: string): Promise<AuthAccount | undefined> {
    const result = await pool.query<AccountRow>(`${accountSelection} where a.id = $1`, [accountId]);
    return result.rows[0] ? accountFromRow(result.rows[0]) : undefined;
  },

  async findEmployeeProfile(employeeId: string) {
    const result = await pool.query<{
      employeeId: string;
      employeeNumber: string;
      displayName: string;
      departmentId: string | null;
    }>(
      `select id as "employeeId",
              employee_number as "employeeNumber",
              display_name as "displayName",
              department_id as "departmentId"
       from employees
       where id = $1 and active = true`,
      [employeeId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      employeeId: row.employeeId,
      employeeNumber: row.employeeNumber,
      displayName: row.displayName,
      ...(row.departmentId ? { departmentId: row.departmentId } : {}),
    };
  },

  async listAccounts() {
    const result = await pool.query<{
      accountId: string;
      employeeNumber: string;
      displayName: string;
      role: FixedRole;
      active: boolean;
      employeeActive: boolean;
      mustChangePassword: boolean;
    }>(
      `select a.id as "accountId",
              e.employee_number as "employeeNumber",
              e.display_name as "displayName",
              a.role,
              a.active,
              e.active as "employeeActive",
              a.must_change_password as "mustChangePassword"
       from user_accounts a
       join employees e on e.id = a.employee_id
       order by e.employee_number`,
    );
    return result.rows.map(({ employeeActive, ...row }) => ({
      ...row,
      active: row.active && employeeActive,
    }));
  },

  async findLoginThrottle(
    identifierHash: string,
  ): Promise<{ failures: number; lockedUntil?: Date } | undefined> {
    const result = await pool.query<{
      failures: number;
      lockedUntil: Date | null;
    }>(
      `select failures, locked_until as "lockedUntil"
       from login_throttles
       where identifier_hash = $1`,
      [identifierHash],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      failures: row.failures,
      ...(row.lockedUntil ? { lockedUntil: row.lockedUntil } : {}),
    };
  },

  async registerLoginFailure(input: {
    identifierHash: string;
    accountId?: string;
    now: Date;
    lockAfter: number;
    lockUntil: Date;
    event: SecurityEventInput;
  }): Promise<{ failures: number; lockedUntil?: Date }> {
    return withTransaction(pool, async (client) => {
      const result = await client.query<{
        failures: number;
        lockedUntil: Date | null;
      }>(
        `insert into login_throttles (
           identifier_hash, failures, locked_until, updated_at
         ) values ($1, 1, null, $2::timestamptz)
         on conflict (identifier_hash) do update set
           failures = case
             when login_throttles.locked_until is not null
               and login_throttles.locked_until <= $2::timestamptz then 1
             else login_throttles.failures + 1
           end,
           locked_until = case
             when (
               case
                 when login_throttles.locked_until is not null
                   and login_throttles.locked_until <= $2::timestamptz then 1
                 else login_throttles.failures + 1
               end
             ) >= $3 then $4::timestamptz
             else null
           end,
           updated_at = $2::timestamptz
         returning failures, locked_until as "lockedUntil"`,
        [input.identifierHash, input.now, input.lockAfter, input.lockUntil],
      );

      if (input.accountId) {
        await client.query(
          `update user_accounts
           set failed_login_attempts = $2,
               locked_until = $3,
               updated_at = $4
           where id = $1`,
          [
            input.accountId,
            result.rows[0]?.failures ?? 1,
            result.rows[0]?.lockedUntil ?? null,
            input.now,
          ],
        );
      }
      await insertSecurityEvent(client, input.event);

      const state = result.rows[0] ?? { failures: 1, lockedUntil: null };
      return {
        failures: state.failures,
        ...(state.lockedUntil ? { lockedUntil: state.lockedUntil } : {}),
      };
    });
  },

  async completeLogin(input: {
    accountId: string;
    identifierHash: string;
    session: StoredSession;
    event: SecurityEventInput;
  }): Promise<void> {
    await withTransaction(pool, async (client) => {
      await client.query(
        `update user_accounts
         set failed_login_attempts = 0,
             locked_until = null,
             last_login_at = $2,
             updated_at = $2
         where id = $1`,
        [input.accountId, input.session.createdAt],
      );
      await client.query("delete from login_throttles where identifier_hash = $1", [
        input.identifierHash,
      ]);
      await client.query(
        `insert into auth_sessions (
           id, account_id, token_hash, session_version, expires_at, created_at
         ) values ($1, $2, $3, $4, $5, $6)`,
        [
          input.session.id,
          input.session.accountId,
          input.session.tokenHash,
          input.session.sessionVersion,
          input.session.expiresAt,
          input.session.createdAt,
        ],
      );
      await insertSecurityEvent(client, input.event);
    });
  },

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<{ account: AuthAccount; session: StoredSession } | undefined> {
    const result = await pool.query<
      AccountRow & {
        sessionId: string;
        tokenHash: string;
        issuedSessionVersion: number;
        expiresAt: Date;
        createdAt: Date;
        revokedAt: Date | null;
      }
    >(
      `select
         a.id,
         a.employee_id as "employeeId",
         e.employee_number as "employeeNumber",
         e.display_name as "displayName",
         e.department_id as "departmentId",
         a.role,
         a.password_hash as "passwordHash",
         a.must_change_password as "mustChangePassword",
         a.active,
         e.active as "employeeActive",
         a.session_version as "sessionVersion",
         s.id as "sessionId",
         s.token_hash as "tokenHash",
         s.session_version as "issuedSessionVersion",
         s.expires_at as "expiresAt",
         s.created_at as "createdAt",
         s.revoked_at as "revokedAt"
       from user_accounts a
       join employees e on e.id = a.employee_id
       join auth_sessions s on s.account_id = a.id
       where s.token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      account: accountFromRow(row),
      session: {
        id: row.sessionId,
        accountId: row.id,
        tokenHash: row.tokenHash,
        sessionVersion: row.issuedSessionVersion,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
      },
    };
  },

  async changePasswordAndRotateSession(input: {
    accountId: string;
    passwordHash: string;
    session: StoredSession;
    expectedSessionVersion: number;
    event: SecurityEventInput;
  }): Promise<AuthAccount | undefined> {
    return withTransaction(pool, async (client) => {
      const update = await client.query<AccountRow>(
        `update user_accounts
         set password_hash = $2,
             must_change_password = false,
             session_version = session_version + 1,
             updated_at = $3
         where id = $1 and session_version = $4
         returning id,
           employee_id as "employeeId",
           role,
           password_hash as "passwordHash",
           must_change_password as "mustChangePassword",
           active,
           session_version as "sessionVersion"`,
        [
          input.accountId,
          input.passwordHash,
          input.session.createdAt,
          input.expectedSessionVersion,
        ],
      );
      const partial = update.rows[0];
      if (!partial) return undefined;
      const employee = await client.query<{
        employeeNumber: string;
        displayName: string;
        departmentId: string | null;
        employeeActive: boolean;
      }>(
        `select employee_number as "employeeNumber",
                display_name as "displayName",
                department_id as "departmentId",
                active as "employeeActive"
         from employees where id = $1`,
        [partial.employeeId],
      );
      const row = { ...partial, ...employee.rows[0] } as AccountRow;

      await client.query(
        "update auth_sessions set revoked_at = $2 where account_id = $1 and revoked_at is null",
        [input.accountId, input.session.createdAt],
      );
      await client.query(
        `insert into auth_sessions (
           id, account_id, token_hash, session_version, expires_at, created_at
         ) values ($1, $2, $3, $4, $5, $6)`,
        [
          input.session.id,
          input.accountId,
          input.session.tokenHash,
          row.sessionVersion,
          input.session.expiresAt,
          input.session.createdAt,
        ],
      );
      await insertSecurityEvent(client, input.event);
      return accountFromRow(row);
    });
  },

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    await pool.query(
      "update auth_sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null",
      [tokenHash, revokedAt],
    );
  },

  async resetPassword(input: {
    accountId: string;
    passwordHash: string;
    revokedAt: Date;
    identifierHash: string;
    event: SecurityEventInput;
  }): Promise<AuthAccount | undefined> {
    return withTransaction(pool, async (client) => {
      const result = await client.query<AccountRow>(
        `update user_accounts a
         set password_hash = $2,
             must_change_password = true,
             failed_login_attempts = 0,
             locked_until = null,
             session_version = session_version + 1,
             updated_at = $3
         from employees e
         where a.id = $1 and e.id = a.employee_id
         returning a.id,
           a.employee_id as "employeeId",
           e.employee_number as "employeeNumber",
           e.display_name as "displayName",
           e.department_id as "departmentId",
           a.role,
           a.password_hash as "passwordHash",
           a.must_change_password as "mustChangePassword",
           a.active,
           e.active as "employeeActive",
           a.session_version as "sessionVersion"`,
        [input.accountId, input.passwordHash, input.revokedAt],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      await client.query(
        "update auth_sessions set revoked_at = $2 where account_id = $1 and revoked_at is null",
        [input.accountId, input.revokedAt],
      );
      await client.query("delete from login_throttles where identifier_hash = $1", [
        input.identifierHash,
      ]);
      await insertSecurityEvent(client, input.event);
      return accountFromRow(row);
    });
  },

  async recordSecurityEvent(input: SecurityEventInput): Promise<void> {
    await insertSecurityEvent(pool, input);
  },
});
