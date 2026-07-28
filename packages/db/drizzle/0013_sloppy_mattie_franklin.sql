CREATE TABLE "training_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"storage_key" uuid NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(150) NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" char(64) NOT NULL,
	"uploaded_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_evidence_tasks" (
	"evidence_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_plan_scope_employees" (
	"plan_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(150) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"material_id" uuid NOT NULL,
	"owner_employee_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"location" varchar(150) NOT NULL,
	"scope_type" varchar(20) NOT NULL,
	"scope_department_id" uuid,
	"scope_position_id" uuid,
	"created_by_account_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_plans_status" CHECK ("training_plans"."status" in ('draft','published','in_progress','completed','cancelled')),
	CONSTRAINT "training_plans_scope" CHECK (("training_plans"."scope_type" = 'department' and "training_plans"."scope_department_id" is not null and "training_plans"."scope_position_id" is null) or ("training_plans"."scope_type" = 'position' and "training_plans"."scope_position_id" is not null and "training_plans"."scope_department_id" is null) or ("training_plans"."scope_type" = 'employees' and "training_plans"."scope_department_id" is null and "training_plans"."scope_position_id" is null)),
	CONSTRAINT "training_plans_time_range" CHECK ("training_plans"."due_at" > "training_plans"."start_at")
);
--> statement-breakpoint
CREATE TABLE "training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"confirmed_by_account_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'assigned' NOT NULL,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"return_reason" varchar(500),
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_tasks_status" CHECK ("training_tasks"."status" in ('assigned','submitted','returned','confirmed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "training_evidence" ADD CONSTRAINT "training_evidence_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_evidence" ADD CONSTRAINT "training_evidence_uploaded_by_account_id_user_accounts_id_fk" FOREIGN KEY ("uploaded_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_evidence_tasks" ADD CONSTRAINT "training_evidence_tasks_evidence_id_training_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."training_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_evidence_tasks" ADD CONSTRAINT "training_evidence_tasks_task_id_training_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."training_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plan_scope_employees" ADD CONSTRAINT "training_plan_scope_employees_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plan_scope_employees" ADD CONSTRAINT "training_plan_scope_employees_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_material_id_training_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."training_materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_owner_employee_id_employees_id_fk" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_scope_department_id_departments_id_fk" FOREIGN KEY ("scope_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_scope_position_id_positions_id_fk" FOREIGN KEY ("scope_position_id") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_created_by_account_id_user_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_task_id_training_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."training_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_confirmed_by_account_id_user_accounts_id_fk" FOREIGN KEY ("confirmed_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_tasks" ADD CONSTRAINT "training_tasks_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_tasks" ADD CONSTRAINT "training_tasks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_evidence_storage_key_unique" ON "training_evidence" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "training_evidence_tasks_unique" ON "training_evidence_tasks" USING btree ("evidence_id","task_id");--> statement-breakpoint
CREATE INDEX "training_evidence_tasks_task_idx" ON "training_evidence_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_plan_scope_employees_unique" ON "training_plan_scope_employees" USING btree ("plan_id","employee_id");--> statement-breakpoint
CREATE INDEX "training_plan_scope_employees_employee_idx" ON "training_plan_scope_employees" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "training_plans_status_idx" ON "training_plans" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "training_records_task_unique" ON "training_records" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_tasks_plan_employee_unique" ON "training_tasks" USING btree ("plan_id","employee_id");--> statement-breakpoint
CREATE INDEX "training_tasks_employee_status_idx" ON "training_tasks" USING btree ("employee_id","status");