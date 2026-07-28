CREATE TABLE "in_app_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_account_id" uuid NOT NULL,
	"event_key" varchar(200) NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(150) NOT NULL,
	"message" varchar(500) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" varchar(200) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"channel_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"error_message" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_status" CHECK ("notification_outbox"."status" in ('pending','sending','sent','failed'))
);
--> statement-breakpoint
CREATE TABLE "webhook_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"webhook_url" varchar(2000) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_recipient_account_id_user_accounts_id_fk" FOREIGN KEY ("recipient_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_channel_id_webhook_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."webhook_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_channels" ADD CONSTRAINT "webhook_channels_created_by_account_id_user_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "in_app_notifications_recipient_event_unique" ON "in_app_notifications" USING btree ("recipient_account_id","event_key");--> statement-breakpoint
CREATE INDEX "in_app_notifications_recipient_created_idx" ON "in_app_notifications" USING btree ("recipient_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_event_channel_unique" ON "notification_outbox" USING btree ("event_key","channel_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_channels_name_unique" ON "webhook_channels" USING btree ("name");
--> statement-breakpoint
CREATE FUNCTION protect_notification_record_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'notification records cannot be deleted' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER in_app_notifications_protect_delete BEFORE DELETE ON in_app_notifications
FOR EACH ROW EXECUTE FUNCTION protect_notification_record_delete();
--> statement-breakpoint
CREATE TRIGGER notification_outbox_protect_delete BEFORE DELETE ON notification_outbox
FOR EACH ROW EXECUTE FUNCTION protect_notification_record_delete();
