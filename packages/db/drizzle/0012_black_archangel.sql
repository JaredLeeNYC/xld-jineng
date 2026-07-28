CREATE TABLE "training_material_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"source_type" varchar(30) NOT NULL,
	"source_reference" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_material_access_grants" ADD CONSTRAINT "training_material_access_grants_material_id_training_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."training_materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_material_access_grants" ADD CONSTRAINT "training_material_access_grants_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_material_access_grants_source_unique" ON "training_material_access_grants" USING btree ("material_id","employee_id","source_type","source_reference");--> statement-breakpoint
CREATE INDEX "training_material_access_grants_employee_idx" ON "training_material_access_grants" USING btree ("employee_id","material_id");