CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"department_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "planned_hours" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "training_tasks" ADD COLUMN "actual_hours" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "areas_department_name_unique" ON "areas" USING btree ("department_id","name");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;