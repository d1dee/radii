CREATE TABLE "agent_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"scope" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tenant_admin_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_membership_agent_id_unique" UNIQUE("agent_id"),
	CONSTRAINT "agent_membership_status_check" CHECK ("agent_membership"."status" in ('active','revoked'))
);
--> statement-breakpoint
CREATE TABLE "agent_payout_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"method" text NOT NULL,
	"account_name" text NOT NULL,
	"destination" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"verification_evidence" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "agent_payout_method_check" CHECK ("agent_payout_profile"."method" in ('mpesa','bank'))
);
--> statement-breakpoint
CREATE TABLE "agent_portal_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "agent_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "agent_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmed_collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"package_payment_id" uuid NOT NULL,
	"customer_user_id" text NOT NULL,
	"tenant_admin_id" text,
	"nas_device_id" uuid,
	"pppoe_service_account_id" uuid,
	"package_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"provider_transaction_id" text,
	"source" text NOT NULL,
	"confirmation_source" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confirmed_collection_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "commission_agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_admin_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commission_agent_status_check" CHECK ("commission_agent"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "commission_agreement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_admin_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"actor_admin_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"rate_bps" integer NOT NULL,
	"basis" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commission_agreement_scope_time_key" UNIQUE("tenant_admin_id","scope_type","scope_id","effective_from"),
	CONSTRAINT "commission_agreement_rate_check" CHECK ("commission_agreement"."rate_bps" between 0 and 10000),
	CONSTRAINT "commission_agreement_basis_check" CHECK ("commission_agreement"."basis" = 'confirmed_collection_gross'),
	CONSTRAINT "commission_agreement_scope_check" CHECK ("commission_agreement"."scope_type" in ('nas','service_account'))
);
--> statement-breakpoint
CREATE TABLE "commission_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_admin_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"debit_account" text NOT NULL,
	"credit_account" text NOT NULL,
	"collection_id" uuid,
	"withdrawal_id" uuid,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commission_journal_collection_id_unique" UNIQUE("collection_id"),
	CONSTRAINT "commission_journal_withdrawal_kind_key" UNIQUE("withdrawal_id","kind"),
	CONSTRAINT "commission_journal_amount_check" CHECK ("commission_journal"."amount" >= 0),
	CONSTRAINT "commission_journal_currency_check" CHECK ("commission_journal"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "commission_journal_accounts_check" CHECK (
        ("commission_journal"."kind" = 'accrual' and "commission_journal"."debit_account" = 'commission_expense' and "commission_journal"."credit_account" = 'available' and "commission_journal"."collection_id" is not null and "commission_journal"."withdrawal_id" is null) or
        ("commission_journal"."kind" = 'reserve' and "commission_journal"."debit_account" = 'available' and "commission_journal"."credit_account" = 'reserved' and "commission_journal"."withdrawal_id" is not null and "commission_journal"."collection_id" is null) or
        ("commission_journal"."kind" = 'release' and "commission_journal"."debit_account" = 'reserved' and "commission_journal"."credit_account" = 'available' and "commission_journal"."withdrawal_id" is not null and "commission_journal"."collection_id" is null) or
        ("commission_journal"."kind" = 'paid' and "commission_journal"."debit_account" = 'reserved' and "commission_journal"."credit_account" = 'external_payment' and "commission_journal"."withdrawal_id" is not null and "commission_journal"."collection_id" is null)
    )
);
--> statement-breakpoint
CREATE TABLE "commission_withdrawal_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"withdrawal_id" uuid NOT NULL,
	"status" text NOT NULL,
	"actor_admin_id" text,
	"actor_type" text DEFAULT 'ADMIN' NOT NULL,
	"actor_agent_user_id" text,
	"reason" text,
	"reference" text,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commission_withdrawal_event_status_key" UNIQUE("withdrawal_id","status"),
	CONSTRAINT "commission_withdrawal_actor_check" CHECK (("commission_withdrawal_event"."actor_type" = 'ADMIN' and "commission_withdrawal_event"."actor_admin_id" is not null and "commission_withdrawal_event"."actor_agent_user_id" is null) or ("commission_withdrawal_event"."actor_type" = 'AGENT' and "commission_withdrawal_event"."actor_admin_id" is null and "commission_withdrawal_event"."actor_agent_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "commission_withdrawal_intent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigserial NOT NULL,
	"tenant_admin_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" text NOT NULL,
	"note" text,
	"payout_snapshot" jsonb,
	"withdrawal_id" uuid,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commission_withdrawal_intent_withdrawal_id_unique" UNIQUE("withdrawal_id"),
	CONSTRAINT "commission_withdrawal_intent_amount_check" CHECK ("commission_withdrawal_intent"."amount" > 0),
	CONSTRAINT "commission_withdrawal_intent_currency_check" CHECK ("commission_withdrawal_intent"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "commission_withdrawal_intent_actor_check" CHECK ("commission_withdrawal_intent"."actor_type" in ('ADMIN','AGENT') and ("commission_withdrawal_intent"."actor_type" <> 'ADMIN' or "commission_withdrawal_intent"."actor_user_id" = "commission_withdrawal_intent"."tenant_admin_id")),
	CONSTRAINT "commission_withdrawal_intent_resolution_check" CHECK ("commission_withdrawal_intent"."resolution" is null or ("commission_withdrawal_intent"."resolution" = 'acknowledged' and "commission_withdrawal_intent"."withdrawal_id" is not null) or ("commission_withdrawal_intent"."resolution" = 'cancelled' and "commission_withdrawal_intent"."withdrawal_id" is null))
);
--> statement-breakpoint
CREATE TABLE "commission_withdrawal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_admin_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'reserved' NOT NULL,
	"reference" text,
	"evidence" text,
	"payout_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_withdrawal_idempotency_key" UNIQUE("tenant_admin_id","idempotency_key"),
	CONSTRAINT "commission_withdrawal_amount_check" CHECK ("commission_withdrawal"."amount" > 0),
	CONSTRAINT "commission_withdrawal_currency_check" CHECK ("commission_withdrawal"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "commission_withdrawal_status_check" CHECK ("commission_withdrawal"."status" in ('reserved','approved','rejected','paid')),
	CONSTRAINT "commission_withdrawal_paid_evidence_check" CHECK ("commission_withdrawal"."status" <> 'paid' or (length(trim("commission_withdrawal"."reference")) > 0 and length(trim("commission_withdrawal"."evidence")) > 0 and "commission_withdrawal"."reference" is not null and "commission_withdrawal"."evidence" is not null))
);
--> statement-breakpoint
ALTER TABLE "agent_account" ADD CONSTRAINT "agent_account_user_id_agent_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."agent_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_membership" ADD CONSTRAINT "agent_membership_agent_id_commission_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."commission_agent"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_membership" ADD CONSTRAINT "agent_membership_tenant_admin_id_admin_user_id_fk" FOREIGN KEY ("tenant_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_membership" ADD CONSTRAINT "agent_membership_user_id_agent_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."agent_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_payout_profile" ADD CONSTRAINT "agent_payout_profile_membership_id_agent_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."agent_membership"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_portal_audit" ADD CONSTRAINT "agent_portal_audit_membership_id_agent_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."agent_membership"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_user_id_agent_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."agent_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_agent" ADD CONSTRAINT "commission_agent_tenant_admin_id_admin_user_id_fk" FOREIGN KEY ("tenant_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_agreement" ADD CONSTRAINT "commission_agreement_tenant_admin_id_admin_user_id_fk" FOREIGN KEY ("tenant_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_agreement" ADD CONSTRAINT "commission_agreement_agent_id_commission_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."commission_agent"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_journal" ADD CONSTRAINT "commission_journal_tenant_admin_id_admin_user_id_fk" FOREIGN KEY ("tenant_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_journal" ADD CONSTRAINT "commission_journal_agent_id_commission_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."commission_agent"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_journal" ADD CONSTRAINT "commission_journal_withdrawal_id_commission_withdrawal_id_fk" FOREIGN KEY ("withdrawal_id") REFERENCES "public"."commission_withdrawal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_withdrawal_event" ADD CONSTRAINT "commission_withdrawal_event_withdrawal_id_commission_withdrawal_id_fk" FOREIGN KEY ("withdrawal_id") REFERENCES "public"."commission_withdrawal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_withdrawal_intent" ADD CONSTRAINT "commission_withdrawal_intent_tenant_admin_id_admin_user_id_fk" FOREIGN KEY ("tenant_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_withdrawal_intent" ADD CONSTRAINT "commission_withdrawal_intent_agent_id_commission_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."commission_agent"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_withdrawal_intent" ADD CONSTRAINT "commission_withdrawal_intent_withdrawal_id_commission_withdrawal_id_fk" FOREIGN KEY ("withdrawal_id") REFERENCES "public"."commission_withdrawal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_withdrawal" ADD CONSTRAINT "commission_withdrawal_tenant_admin_id_admin_user_id_fk" FOREIGN KEY ("tenant_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_withdrawal" ADD CONSTRAINT "commission_withdrawal_agent_id_commission_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."commission_agent"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_account_user_idx" ON "agent_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_membership_user_idx" ON "agent_membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_payout_membership_idx" ON "agent_payout_profile" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_portal_audit_membership_idx" ON "agent_portal_audit" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_session_user_idx" ON "agent_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_verification_identifier_idx" ON "agent_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "confirmed_collection_cursor_idx" ON "confirmed_collection" USING btree ("recorded_at","id");--> statement-breakpoint
CREATE INDEX "confirmed_collection_tenant_idx" ON "confirmed_collection" USING btree ("tenant_admin_id");--> statement-breakpoint
CREATE INDEX "commission_agent_tenant_idx" ON "commission_agent" USING btree ("tenant_admin_id");--> statement-breakpoint
CREATE INDEX "commission_agreement_agent_idx" ON "commission_agreement" USING btree ("tenant_admin_id","agent_id","effective_from");--> statement-breakpoint
CREATE INDEX "commission_journal_agent_idx" ON "commission_journal" USING btree ("tenant_admin_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "commission_withdrawal_intent_scope_idx" ON "commission_withdrawal_intent" USING btree ("tenant_admin_id","agent_id","actor_type","actor_user_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_withdrawal_intent_unresolved_key" ON "commission_withdrawal_intent" USING btree ("tenant_admin_id","agent_id","actor_type","actor_user_id") WHERE "commission_withdrawal_intent"."resolution" is null;--> statement-breakpoint
CREATE INDEX "commission_withdrawal_agent_idx" ON "commission_withdrawal" USING btree ("tenant_admin_id","agent_id","created_at");