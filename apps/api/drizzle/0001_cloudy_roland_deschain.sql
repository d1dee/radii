CREATE TABLE "whatsapp_outbox" (
	"session_key" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_outbox" ADD CONSTRAINT "whatsapp_outbox_admin_id_admin_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;