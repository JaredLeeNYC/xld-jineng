CREATE TABLE "training_material_skills" (
	"material_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(150) NOT NULL,
	"category" varchar(80) NOT NULL,
	"description" varchar(500),
	"kind" varchar(10) NOT NULL,
	"external_url" varchar(2000),
	"storage_key" varchar(150),
	"original_filename" varchar(255),
	"mime_type" varchar(150),
	"size_bytes" integer,
	"checksum" char(64),
	"active" boolean DEFAULT true NOT NULL,
	"created_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_materials_kind" CHECK ("training_materials"."kind" in ('file', 'link')),
	CONSTRAINT "training_materials_source" CHECK (("training_materials"."kind" = 'file' and "training_materials"."storage_key" is not null and "training_materials"."external_url" is null and "training_materials"."checksum" is not null) or ("training_materials"."kind" = 'link' and "training_materials"."external_url" is not null and "training_materials"."storage_key" is null and "training_materials"."checksum" is null))
);
--> statement-breakpoint
ALTER TABLE "training_material_skills" ADD CONSTRAINT "training_material_skills_material_id_training_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."training_materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_material_skills" ADD CONSTRAINT "training_material_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_materials" ADD CONSTRAINT "training_materials_created_by_account_id_user_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_material_skills_unique" ON "training_material_skills" USING btree ("material_id","skill_id");--> statement-breakpoint
CREATE INDEX "training_material_skills_skill_idx" ON "training_material_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "training_materials_category_idx" ON "training_materials" USING btree ("category");