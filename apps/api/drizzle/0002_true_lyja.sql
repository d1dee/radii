CREATE TABLE "pppoe_expiry_reminder" (
	"activation_id" uuid NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"admin_id" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pppoe_expiry_reminder_activation_id_activated_at_expires_at_pk" PRIMARY KEY("activation_id","activated_at","expires_at")
);
--> statement-breakpoint
ALTER TABLE "pppoe_expiry_reminder" ADD CONSTRAINT "pppoe_expiry_reminder_activation_id_activated_packages_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activated_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pppoe_expiry_reminder" ADD CONSTRAINT "pppoe_expiry_reminder_admin_id_admin_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;