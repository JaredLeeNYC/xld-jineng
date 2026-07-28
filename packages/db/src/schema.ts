import { fixedRoles, skillCategories } from "@jineng/skill-matrix-shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const fixedRoleEnum = pgEnum("fixed_role", fixedRoles);
export const skillCategoryEnum = pgEnum("skill_category", skillCategories);

export const systemMetadata = pgTable("system_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 30 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check("departments_code_canonical", sql`${table.code} = upper(trim(${table.code}))`),
    uniqueIndex("departments_code_unique").on(table.code),
  ],
);

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 30 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check("positions_code_canonical", sql`${table.code} = upper(trim(${table.code}))`),
    uniqueIndex("positions_code_unique").on(table.code),
    index("positions_department_idx").on(table.departmentId),
  ],
);

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeNumber: varchar("employee_number", { length: 50 }).notNull(),
    displayName: varchar("display_name", { length: 100 }).notNull(),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "restrict",
    }),
    hireDate: date("hire_date"),
    phone: varchar("phone", { length: 30 }),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check(
      "employees_number_canonical",
      sql`${table.employeeNumber} = upper(trim(${table.employeeNumber}))`,
    ),
    uniqueIndex("employees_number_unique").on(table.employeeNumber),
    index("employees_department_idx").on(table.departmentId),
  ],
);

export const positionAssignments = pgTable(
  "position_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    reason: varchar("reason", { length: 300 }).notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      "position_assignments_valid_range",
      sql`${table.endedAt} is null or ${table.endedAt} > ${table.startedAt}`,
    ),
    uniqueIndex("position_assignments_current_employee_unique")
      .on(table.employeeId)
      .where(sql`${table.endedAt} is null`),
    index("position_assignments_employee_idx").on(table.employeeId, table.startedAt),
  ],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 30 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    category: skillCategoryEnum("category").notNull(),
    reassessmentRequired: boolean("reassessment_required").notNull().default(false),
    validityMonths: smallint("validity_months"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check("skills_code_canonical", sql`${table.code} = upper(trim(${table.code}))`),
    check(
      "skills_validity_policy",
      sql`(${table.reassessmentRequired} = false and ${table.validityMonths} is null) or (${table.reassessmentRequired} = true and ${table.validityMonths} between 1 and 120)`,
    ),
    uniqueIndex("skills_code_unique").on(table.code),
  ],
);

export const positionSkillRequirements = pgTable(
  "position_skill_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "restrict" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "restrict" }),
    requiredLevel: smallint("required_level").notNull(),
    required: boolean("required").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check("position_skill_requirements_level", sql`${table.requiredLevel} between 0 and 4`),
    uniqueIndex("position_skill_requirements_current_unique").on(table.positionId, table.skillId),
  ],
);

export const skillAssessments = pgTable(
  "skill_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "restrict" }),
    level: smallint("level").notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    passed: boolean("passed").notNull(),
    method: varchar("method", { length: 20 }),
    assessorAccountId: uuid("assessor_account_id").references(() => userAccounts.id, {
      onDelete: "restrict",
    }),
    reason: varchar("reason", { length: 500 }),
    remediation: varchar("remediation", { length: 500 }),
    sourceType: varchar("source_type", { length: 30 }).notNull(),
    sourceReference: varchar("source_reference", { length: 300 }).notNull(),
    assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    evidenceStorageKey: varchar("evidence_storage_key", { length: 150 }),
    evidenceOriginalFilename: varchar("evidence_original_filename", { length: 255 }),
    evidenceMimeType: varchar("evidence_mime_type", { length: 150 }),
    evidenceSizeBytes: integer("evidence_size_bytes"),
    evidenceChecksum: char("evidence_checksum", { length: 64 }),
    managerConfirmedByAccountId: uuid("manager_confirmed_by_account_id").references(
      () => userAccounts.id,
      { onDelete: "restrict" },
    ),
    managerConfirmedAt: timestamp("manager_confirmed_at", { withTimezone: true }),
    returnedByAccountId: uuid("returned_by_account_id").references(() => userAccounts.id, {
      onDelete: "restrict",
    }),
    returnReason: varchar("return_reason", { length: 500 }),
    archivedByAccountId: uuid("archived_by_account_id").references(() => userAccounts.id, {
      onDelete: "restrict",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    voidedByAccountId: uuid("voided_by_account_id").references(() => userAccounts.id, {
      onDelete: "restrict",
    }),
    voidReason: varchar("void_reason", { length: 500 }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    replacesAssessmentId: uuid("replaces_assessment_id").references(
      (): AnyPgColumn => skillAssessments.id,
      { onDelete: "restrict" },
    ),
    ...timestamps,
  },
  (table) => [
    check("skill_assessments_level", sql`${table.level} between 0 and 4`),
    check(
      "skill_assessments_status",
      sql`${table.status} in ('draft','pending_manager','pending_hr','archived','returned','voided')`,
    ),
    check(
      "skill_assessments_method",
      sql`${table.method} is null or ${table.method} in ('written','practical','comprehensive')`,
    ),
    uniqueIndex("skill_assessments_identity_unique").on(table.id, table.employeeId, table.skillId),
    index("skill_assessments_employee_skill_idx").on(
      table.employeeId,
      table.skillId,
      table.assessedAt,
    ),
  ],
);

export const validSkillAssessments = pgTable(
  "valid_skill_assessments",
  {
    assessmentId: uuid("assessment_id").primaryKey(),
    employeeId: uuid("employee_id").notNull(),
    skillId: uuid("skill_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.assessmentId, table.employeeId, table.skillId],
      foreignColumns: [skillAssessments.id, skillAssessments.employeeId, skillAssessments.skillId],
      name: "valid_skill_assessments_identity_fk",
    }).onDelete("cascade"),
    uniqueIndex("valid_skill_assessments_identity_unique").on(
      table.assessmentId,
      table.employeeId,
      table.skillId,
    ),
  ],
);

export const trainingMaterials = pgTable(
  "training_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 150 }).notNull(),
    category: varchar("category", { length: 80 }).notNull(),
    description: varchar("description", { length: 500 }),
    kind: varchar("kind", { length: 10 }).notNull(),
    externalUrl: varchar("external_url", { length: 2_000 }),
    storageKey: varchar("storage_key", { length: 150 }),
    originalFilename: varchar("original_filename", { length: 255 }),
    mimeType: varchar("mime_type", { length: 150 }),
    sizeBytes: integer("size_bytes"),
    checksum: char("checksum", { length: 64 }),
    active: boolean("active").notNull().default(true),
    createdByAccountId: uuid("created_by_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    check("training_materials_kind", sql`${table.kind} in ('file', 'link')`),
    check(
      "training_materials_source",
      sql`(${table.kind} = 'file' and ${table.storageKey} is not null and ${table.externalUrl} is null and ${table.checksum} is not null) or (${table.kind} = 'link' and ${table.externalUrl} is not null and ${table.storageKey} is null and ${table.checksum} is null)`,
    ),
    index("training_materials_category_idx").on(table.category),
  ],
);

export const trainingMaterialSkills = pgTable(
  "training_material_skills",
  {
    materialId: uuid("material_id")
      .notNull()
      .references(() => trainingMaterials.id, { onDelete: "restrict" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("training_material_skills_unique").on(table.materialId, table.skillId),
    index("training_material_skills_skill_idx").on(table.skillId),
  ],
);

export const trainingMaterialAccessGrants = pgTable(
  "training_material_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => trainingMaterials.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    sourceType: varchar("source_type", { length: 30 }).notNull(),
    sourceReference: varchar("source_reference", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("training_material_access_grants_source_unique").on(
      table.materialId,
      table.employeeId,
      table.sourceType,
      table.sourceReference,
    ),
    index("training_material_access_grants_employee_idx").on(table.employeeId, table.materialId),
  ],
);

export const trainingPlans = pgTable(
  "training_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 150 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    materialId: uuid("material_id")
      .notNull()
      .references(() => trainingMaterials.id, { onDelete: "restrict" }),
    ownerEmployeeId: uuid("owner_employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    location: varchar("location", { length: 150 }).notNull(),
    scopeType: varchar("scope_type", { length: 20 }).notNull(),
    scopeDepartmentId: uuid("scope_department_id").references(() => departments.id, {
      onDelete: "restrict",
    }),
    scopePositionId: uuid("scope_position_id").references(() => positions.id, {
      onDelete: "restrict",
    }),
    createdByAccountId: uuid("created_by_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      "training_plans_status",
      sql`${table.status} in ('draft','published','in_progress','completed','cancelled')`,
    ),
    check(
      "training_plans_scope",
      sql`(${table.scopeType} = 'department' and ${table.scopeDepartmentId} is not null and ${table.scopePositionId} is null) or (${table.scopeType} = 'position' and ${table.scopePositionId} is not null and ${table.scopeDepartmentId} is null) or (${table.scopeType} = 'employees' and ${table.scopeDepartmentId} is null and ${table.scopePositionId} is null)`,
    ),
    check("training_plans_time_range", sql`${table.dueAt} > ${table.startAt}`),
    index("training_plans_status_idx").on(table.status),
  ],
);

export const trainingPlanScopeEmployees = pgTable(
  "training_plan_scope_employees",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => trainingPlans.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("training_plan_scope_employees_unique").on(table.planId, table.employeeId),
    index("training_plan_scope_employees_employee_idx").on(table.employeeId),
  ],
);

export const trainingTasks = pgTable(
  "training_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => trainingPlans.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 20 }).notNull().default("assigned"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnReason: varchar("return_reason", { length: 500 }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      "training_tasks_status",
      sql`${table.status} in ('assigned','submitted','returned','confirmed','cancelled')`,
    ),
    uniqueIndex("training_tasks_plan_employee_unique").on(table.planId, table.employeeId),
    index("training_tasks_employee_status_idx").on(table.employeeId, table.status),
  ],
);

export const trainingRecords = pgTable(
  "training_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => trainingTasks.id, { onDelete: "restrict" }),
    confirmedByAccountId: uuid("confirmed_by_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "restrict" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("training_records_task_unique").on(table.taskId)],
);

export const trainingEvidence = pgTable(
  "training_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => trainingPlans.id, { onDelete: "restrict" }),
    storageKey: uuid("storage_key").notNull(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 150 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksum: char("checksum", { length: 64 }).notNull(),
    uploadedByAccountId: uuid("uploaded_by_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("training_evidence_storage_key_unique").on(table.storageKey)],
);

export const trainingEvidenceTasks = pgTable(
  "training_evidence_tasks",
  {
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => trainingEvidence.id, { onDelete: "restrict" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => trainingTasks.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("training_evidence_tasks_unique").on(table.evidenceId, table.taskId),
    index("training_evidence_tasks_task_idx").on(table.taskId),
  ],
);

export const employeeCurrentSkills = pgTable(
  "employee_current_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => skillAssessments.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.assessmentId, table.employeeId, table.skillId],
      foreignColumns: [skillAssessments.id, skillAssessments.employeeId, skillAssessments.skillId],
      name: "employee_current_skills_assessment_identity_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.assessmentId, table.employeeId, table.skillId],
      foreignColumns: [
        validSkillAssessments.assessmentId,
        validSkillAssessments.employeeId,
        validSkillAssessments.skillId,
      ],
      name: "employee_current_skills_valid_assessment_fk",
    }).onDelete("restrict"),
    uniqueIndex("employee_current_skills_employee_skill_unique").on(
      table.employeeId,
      table.skillId,
    ),
    uniqueIndex("employee_current_skills_assessment_unique").on(table.assessmentId),
  ],
);

export const inAppNotifications = pgTable(
  "in_app_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientAccountId: uuid("recipient_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "restrict" }),
    eventKey: varchar("event_key", { length: 200 }).notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    title: varchar("title", { length: 150 }).notNull(),
    message: varchar("message", { length: 500 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }),
    entityId: uuid("entity_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("in_app_notifications_recipient_event_unique").on(
      table.recipientAccountId,
      table.eventKey,
    ),
    index("in_app_notifications_recipient_created_idx").on(
      table.recipientAccountId,
      table.createdAt,
    ),
  ],
);

export const webhookChannels = pgTable(
  "webhook_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    webhookUrl: varchar("webhook_url", { length: 2_000 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdByAccountId: uuid("created_by_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("webhook_channels_name_unique").on(table.name)],
);

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventKey: varchar("event_key", { length: 200 }).notNull(),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => webhookChannels.id, { onDelete: "restrict" }),
    payload: jsonb("payload").$type<{ title: string; message: string }>().notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    leaseToken: uuid("lease_token"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    errorMessage: varchar("error_message", { length: 500 }),
    ...timestamps,
  },
  (table) => [
    check(
      "notification_outbox_status",
      sql`${table.status} in ('pending','sending','sent','failed')`,
    ),
    uniqueIndex("notification_outbox_event_channel_unique").on(table.eventKey, table.channelId),
    index("notification_outbox_pending_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const skillImportPreviews = pgTable("skill_import_previews", {
  id: uuid("id").primaryKey(),
  actorAccountId: uuid("actor_account_id")
    .notNull()
    .references(() => userAccounts.id, { onDelete: "cascade" }),
  rows: jsonb("rows").$type<Array<Record<string, unknown>>>().notNull(),
  errors: jsonb("errors").$type<Array<Record<string, unknown>>>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userAccounts = pgTable(
  "user_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    passwordHash: text("password_hash").notNull(),
    role: fixedRoleEnum("role").notNull(),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    active: boolean("active").notNull().default(true),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    sessionVersion: integer("session_version").notNull().default(1),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("user_accounts_employee_unique").on(table.employeeId)],
);

export const loginThrottles = pgTable("login_throttles", {
  identifierHash: char("identifier_hash", { length: 64 }).primaryKey(),
  failures: integer("failures").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "cascade" }),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    sessionVersion: integer("session_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
    index("auth_sessions_account_idx").on(table.accountId),
  ],
);

export const securityEvents = pgTable(
  "security_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: varchar("type", { length: 80 }).notNull(),
    accountId: uuid("account_id").references(() => userAccounts.id, {
      onDelete: "set null",
    }),
    identifierHash: char("identifier_hash", { length: 64 }),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("security_events_account_idx").on(table.accountId),
    index("security_events_created_at_idx").on(table.createdAt),
  ],
);

export const importPreviews = pgTable("import_previews", {
  id: uuid("id").primaryKey(),
  actorAccountId: uuid("actor_account_id")
    .notNull()
    .references(() => userAccounts.id, { onDelete: "cascade" }),
  rows: jsonb("rows").$type<Array<Record<string, unknown>>>().notNull(),
  errors: jsonb("errors").$type<Array<Record<string, unknown>>>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorAccountId: uuid("actor_account_id").references(() => userAccounts.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 80 }).notNull(),
    objectType: varchar("object_type", { length: 80 }).notNull(),
    objectId: varchar("object_id", { length: 100 }).notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_actor_idx").on(table.actorAccountId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);
