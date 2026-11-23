CREATE TABLE "admin_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "admin_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "admin_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	CONSTRAINT "admin_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "admin_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_setting" (
	"admin_user_id" text PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"username" text,
	"display_username" text,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "user_flag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activated_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_payment_id" uuid NOT NULL,
	"radacct_id" bigserial NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"package_id" uuid NOT NULL,
	"pppoe_service_account_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"time_allowance_seconds" integer,
	"fup_window_start" timestamp with time zone,
	"fup_used_bytes" bigint DEFAULT 0 NOT NULL,
	"fup_threshold_reached" boolean DEFAULT false NOT NULL,
	"fup_effective_rate_limit" text,
	"fup_evaluated_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "activated_packages_payment_id_key" UNIQUE("package_payment_id")
);
--> statement-breakpoint
CREATE TABLE "activation_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activation_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"source" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"package_id" uuid NOT NULL,
	"nas_device_id" uuid,
	"tenant_admin_id" text,
	"pppoe_service_account_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"phone_number" text NOT NULL,
	"transaction" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"audience_id" uuid,
	"eligibility" jsonb,
	"type" text DEFAULT 'hotspot' NOT NULL,
	"category" text NOT NULL,
	"category_sort_order" integer,
	"sort_order" integer,
	"session_length" integer NOT NULL,
	"createdBy" text,
	"price" numeric(10, 2) NOT NULL,
	"max_devices" integer NOT NULL,
	"no_expiry" boolean NOT NULL,
	"description" text,
	"note" text,
	"upload_rate" integer NOT NULL,
	"download_rate" integer NOT NULL,
	"download_quota" integer NOT NULL,
	"upload_quota" integer NOT NULL,
	"fair_usage_limit" integer DEFAULT 0 NOT NULL,
	"fair_usage_window_value" integer DEFAULT 1 NOT NULL,
	"fair_usage_window_unit" text DEFAULT 'session' NOT NULL,
	"fair_usage_upload_rate" integer DEFAULT 0 NOT NULL,
	"fair_usage_download_rate" integer DEFAULT 0 NOT NULL,
	"burst_upload_rate" integer DEFAULT 0 NOT NULL,
	"burst_download_rate" integer DEFAULT 0 NOT NULL,
	"burst_upload_threshold" integer DEFAULT 0 NOT NULL,
	"burst_download_threshold" integer DEFAULT 0 NOT NULL,
	"burst_time" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radius_usage_delta" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"radacct_id" bigint,
	"activation_id" uuid NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"input_octets" bigint NOT NULL,
	"output_octets" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotspot_login_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nas_device_id" uuid NOT NULL,
	"mac" text NOT NULL,
	"ip" "inet",
	"username" text,
	"link_login" text,
	"link_login_only" text,
	"link_orig" text,
	"error" text,
	"extra" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"hotspot_username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nas_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ip_address" "inet" NOT NULL,
	"mac_address" varchar(17),
	"model" text,
	"serial_number" text,
	"firmware_version" text,
	"location" text,
	"owner_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nas_device_serial_number_unique" UNIQUE("serial_number")
);
--> statement-breakpoint
CREATE TABLE "nas_setup_script" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nas_device_id" uuid NOT NULL,
	"script" text NOT NULL,
	"hotspot_pages" jsonb,
	"hotspot_interface" text,
	"hotspot_network" text,
	"hotspot_dns_name" text,
	"brand_name" text,
	"pppoe_interface" text,
	"pppoe_network" text,
	"ip_lockdown" boolean,
	"session_monitoring_enabled" boolean DEFAULT false NOT NULL,
	"wg_public_key" text,
	"wg_client_ip" "inet" NOT NULL,
	"wg_psk" text NOT NULL,
	"radius_secret" text NOT NULL,
	"bootstrap_token_hash" text,
	"bootstrap_expires_at" timestamp with time zone,
	"page_token_hash" text,
	"wg_key_reported_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nas_setup_script_nas_device_id_key" UNIQUE("nas_device_id"),
	CONSTRAINT "nas_setup_script_wg_client_ip_key" UNIQUE("wg_client_ip")
);
--> statement-breakpoint
CREATE TABLE "package_nas_device" (
	"package_id" uuid NOT NULL,
	"nas_device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_nas_device_package_id_nas_device_id_pk" PRIMARY KEY("package_id","nas_device_id")
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_transaction_id" text,
	"provider_reference" text,
	"description" text,
	"metadata" jsonb,
	"callback_nonces" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"provider_request_id" text,
	"provider_conversation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pppoe_service_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_user_id" text,
	"tenant_admin_id" text NOT NULL,
	"nas_device_id" uuid,
	"normalized_phone" text NOT NULL,
	"username" text NOT NULL,
	"claim_code_hash" text,
	"label" text,
	"customer_name" text,
	"location" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pppoe_service_account_claim_code_hash_key" UNIQUE("claim_code_hash"),
	CONSTRAINT "pppoe_service_account_username_key" UNIQUE("username"),
	CONSTRAINT "pppoe_service_account_phone_e164_check" CHECK ("pppoe_service_account"."normalized_phone" ~ '^[+][1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "nas" (
	"id" serial PRIMARY KEY NOT NULL,
	"nasname" text NOT NULL,
	"shortname" text NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"ports" integer,
	"secret" text NOT NULL,
	"server" text,
	"community" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "radacct" (
	"radacctid" bigserial PRIMARY KEY NOT NULL,
	"acctsessionid" text NOT NULL,
	"acctuniqueid" text NOT NULL,
	"username" text,
	"realm" text,
	"nasipaddress" "inet" NOT NULL,
	"nasportid" text,
	"nasporttype" text,
	"acctstarttime" timestamp with time zone,
	"acctupdatetime" timestamp with time zone,
	"acctstoptime" timestamp with time zone,
	"acctinterval" bigint,
	"acctsessiontime" bigint,
	"bank_waived_seconds" bigint DEFAULT 0 NOT NULL,
	"bank_bonus_start_seconds" bigint,
	"bank_bonus_end_seconds" bigint,
	"acctauthentic" text,
	"connectinfo_start" text,
	"connectinfo_stop" text,
	"acctinputoctets" bigint,
	"acctoutputoctets" bigint,
	"usage_captured_input_octets" bigint,
	"usage_captured_output_octets" bigint,
	"calledstationid" text,
	"callingstationid" text,
	"acctterminatecause" text,
	"servicetype" text,
	"framedprotocol" text,
	"framedipaddress" "inet",
	"framedipv6address" "inet",
	"framedipv6prefix" "inet",
	"framedinterfaceid" text,
	"delegatedipv6prefix" "inet",
	"class" text,
	"fup_window_start" timestamp with time zone,
	"fup_rate_limit" text,
	"fup_forced" boolean DEFAULT false NOT NULL,
	"session_timeout_expires_at" timestamp with time zone,
	"fup_used_bytes" bigint DEFAULT 0 NOT NULL,
	"fup_threshold_reached" boolean DEFAULT false NOT NULL,
	"fup_evaluated_at" timestamp with time zone,
	CONSTRAINT "radacct_acctuniqueid_key" UNIQUE("acctuniqueid")
);
--> statement-breakpoint
CREATE TABLE "radcheck" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"attribute" text DEFAULT '' NOT NULL,
	"op" varchar(2) DEFAULT '==' NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	CONSTRAINT "radcheck_username_attribute_key" UNIQUE("username","attribute")
);
--> statement-breakpoint
CREATE TABLE "radgroupcheck" (
	"id" serial PRIMARY KEY NOT NULL,
	"groupname" text DEFAULT '' NOT NULL,
	"attribute" text DEFAULT '' NOT NULL,
	"op" varchar(2) DEFAULT '==' NOT NULL,
	"value" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radgroupreply" (
	"id" serial PRIMARY KEY NOT NULL,
	"groupname" text DEFAULT '' NOT NULL,
	"attribute" text DEFAULT '' NOT NULL,
	"op" varchar(2) DEFAULT '=' NOT NULL,
	"value" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radpostauth" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"pass" text,
	"reply" text,
	"calledstationid" text,
	"callingstationid" text,
	"authdate" timestamp with time zone DEFAULT now() NOT NULL,
	"class" text
);
--> statement-breakpoint
CREATE TABLE "radreply" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"attribute" text DEFAULT '' NOT NULL,
	"op" varchar(2) DEFAULT '=' NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	CONSTRAINT "radreply_username_attribute_key" UNIQUE("username","attribute")
);
--> statement-breakpoint
CREATE TABLE "radusergroup" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"groupname" text DEFAULT '' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_admin_tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_admin_tag_admin_user_key" UNIQUE("admin_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "customer_tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_tag_owner_user_tag_key" UNIQUE("owner_id","user_id","tag")
);
--> statement-breakpoint
CREATE TABLE "package_audience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"conditions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_audience_owner_name_key" UNIQUE("owner_id","name")
);
--> statement-breakpoint
ALTER TABLE "admin_account" ADD CONSTRAINT "admin_account_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_setting" ADD CONSTRAINT "admin_setting_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_flag" ADD CONSTRAINT "user_flag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_flag" ADD CONSTRAINT "user_flag_created_by_admin_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activated_packages" ADD CONSTRAINT "activated_packages_package_payment_id_package_payments_id_fk" FOREIGN KEY ("package_payment_id") REFERENCES "public"."package_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activated_packages" ADD CONSTRAINT "activated_packages_radacct_id_radacct_radacctid_fk" FOREIGN KEY ("radacct_id") REFERENCES "public"."radacct"("radacctid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activated_packages" ADD CONSTRAINT "activated_packages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activated_packages" ADD CONSTRAINT "activated_packages_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activated_packages" ADD CONSTRAINT "activated_packages_pppoe_service_account_id_pppoe_service_account_id_fk" FOREIGN KEY ("pppoe_service_account_id") REFERENCES "public"."pppoe_service_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_event" ADD CONSTRAINT "activation_event_activation_id_activated_packages_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activated_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_payments" ADD CONSTRAINT "package_payments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_payments" ADD CONSTRAINT "package_payments_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_payments" ADD CONSTRAINT "package_payments_nas_device_id_nas_device_id_fk" FOREIGN KEY ("nas_device_id") REFERENCES "public"."nas_device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_payments" ADD CONSTRAINT "package_payments_tenant_admin_id_admin_user_id_fk" FOREIGN KEY ("tenant_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_payments" ADD CONSTRAINT "package_payments_pppoe_service_account_id_pppoe_service_account_id_fk" FOREIGN KEY ("pppoe_service_account_id") REFERENCES "public"."pppoe_service_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_payments" ADD CONSTRAINT "package_payments_transaction_transaction_id_fk" FOREIGN KEY ("transaction") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_audience_id_package_audience_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."package_audience"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_createdBy_admin_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."admin_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_usage_delta" ADD CONSTRAINT "radius_usage_delta_radacct_id_radacct_radacctid_fk" FOREIGN KEY ("radacct_id") REFERENCES "public"."radacct"("radacctid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_usage_delta" ADD CONSTRAINT "radius_usage_delta_activation_id_activated_packages_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activated_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotspot_login_request" ADD CONSTRAINT "hotspot_login_request_nas_device_id_nas_device_id_fk" FOREIGN KEY ("nas_device_id") REFERENCES "public"."nas_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotspot_login_request" ADD CONSTRAINT "hotspot_login_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nas_device" ADD CONSTRAINT "nas_device_owner_id_admin_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."admin_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nas_setup_script" ADD CONSTRAINT "nas_setup_script_nas_device_id_nas_device_id_fk" FOREIGN KEY ("nas_device_id") REFERENCES "public"."nas_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_nas_device" ADD CONSTRAINT "package_nas_device_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_nas_device" ADD CONSTRAINT "package_nas_device_nas_device_id_nas_device_id_fk" FOREIGN KEY ("nas_device_id") REFERENCES "public"."nas_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_log" ADD CONSTRAINT "transaction_log_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pppoe_service_account" ADD CONSTRAINT "pppoe_service_account_customer_user_id_user_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pppoe_service_account" ADD CONSTRAINT "pppoe_service_account_tenant_admin_id_admin_user_id_fk" FOREIGN KEY ("tenant_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pppoe_service_account" ADD CONSTRAINT "pppoe_service_account_nas_device_id_nas_device_id_fk" FOREIGN KEY ("nas_device_id") REFERENCES "public"."nas_device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_admin_tag" ADD CONSTRAINT "user_admin_tag_admin_id_admin_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_admin_tag" ADD CONSTRAINT "user_admin_tag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tag" ADD CONSTRAINT "customer_tag_owner_id_admin_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tag" ADD CONSTRAINT "customer_tag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_audience" ADD CONSTRAINT "package_audience_owner_id_admin_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_account_userId_idx" ON "admin_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_session_userId_idx" ON "admin_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_verification_identifier_idx" ON "admin_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_flag_user_id_idx" ON "user_flag" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "activated_packages_payment_id_idx" ON "activated_packages" USING btree ("package_payment_id");--> statement-breakpoint
CREATE INDEX "activated_packages_radacct_id_idx" ON "activated_packages" USING btree ("radacct_id");--> statement-breakpoint
CREATE INDEX "activated_packages_user_id_idx" ON "activated_packages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activated_packages_pppoe_account_id_idx" ON "activated_packages" USING btree ("pppoe_service_account_id");--> statement-breakpoint
CREATE INDEX "activation_event_activation_created_at_idx" ON "activation_event" USING btree ("activation_id","created_at");--> statement-breakpoint
CREATE INDEX "package_payments_user_id_idx" ON "package_payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "package_payments_package_id_idx" ON "package_payments" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "package_payments_nas_device_id_idx" ON "package_payments" USING btree ("nas_device_id");--> statement-breakpoint
CREATE INDEX "package_payments_tenant_admin_id_idx" ON "package_payments" USING btree ("tenant_admin_id");--> statement-breakpoint
CREATE INDEX "package_payments_pppoe_account_id_idx" ON "package_payments" USING btree ("pppoe_service_account_id");--> statement-breakpoint
CREATE INDEX "packages_type_idx" ON "packages" USING btree ("type");--> statement-breakpoint
CREATE INDEX "packages_category_idx" ON "packages" USING btree ("category");--> statement-breakpoint
CREATE INDEX "packages_portal_order_idx" ON "packages" USING btree ("type","category_sort_order","sort_order");--> statement-breakpoint
CREATE INDEX "packages_archived_at_idx" ON "packages" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "packages_audience_id_idx" ON "packages" USING btree ("audience_id");--> statement-breakpoint
CREATE INDEX "radius_usage_delta_activation_observed_idx" ON "radius_usage_delta" USING btree ("activation_id","observed_at");--> statement-breakpoint
CREATE INDEX "radius_usage_delta_radacct_idx" ON "radius_usage_delta" USING btree ("radacct_id");--> statement-breakpoint
CREATE INDEX "hotspot_login_request_nas_device_id_idx" ON "hotspot_login_request" USING btree ("nas_device_id");--> statement-breakpoint
CREATE INDEX "hotspot_login_request_mac_idx" ON "hotspot_login_request" USING btree ("mac");--> statement-breakpoint
CREATE INDEX "hotspot_login_request_status_idx" ON "hotspot_login_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hotspot_login_request_user_id_idx" ON "hotspot_login_request" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hotspot_login_request_hotspot_username_idx" ON "hotspot_login_request" USING btree ("hotspot_username");--> statement-breakpoint
CREATE INDEX "nas_device_ip_address_idx" ON "nas_device" USING btree ("ip_address" inet_ops);--> statement-breakpoint
CREATE INDEX "nas_device_owner_id_idx" ON "nas_device" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "nas_device_status_idx" ON "nas_device" USING btree ("status");--> statement-breakpoint
CREATE INDEX "nas_device_serial_number_idx" ON "nas_device" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "nas_setup_script_status_idx" ON "nas_setup_script" USING btree ("status");--> statement-breakpoint
CREATE INDEX "package_nas_device_nas_device_id_idx" ON "package_nas_device" USING btree ("nas_device_id");--> statement-breakpoint
CREATE INDEX "transaction_user_id_idx" ON "transaction" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transaction_provider_idx" ON "transaction" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "transaction_provider_transaction_id_idx" ON "transaction" USING btree ("provider_transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_status_idx" ON "transaction" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transaction_log_transaction_id_idx" ON "transaction_log" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_log_provider_idx" ON "transaction_log" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "transaction_log_event_type_idx" ON "transaction_log" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "pppoe_service_account_customer_nas_key" ON "pppoe_service_account" USING btree ("customer_user_id","nas_device_id") WHERE "pppoe_service_account"."status" <> 'closed';--> statement-breakpoint
CREATE UNIQUE INDEX "pppoe_service_account_nas_phone_key" ON "pppoe_service_account" USING btree ("nas_device_id","normalized_phone") WHERE "pppoe_service_account"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "pppoe_service_account_tenant_idx" ON "pppoe_service_account" USING btree ("tenant_admin_id");--> statement-breakpoint
CREATE INDEX "pppoe_service_account_customer_idx" ON "pppoe_service_account" USING btree ("customer_user_id");--> statement-breakpoint
CREATE INDEX "pppoe_service_account_nas_idx" ON "pppoe_service_account" USING btree ("nas_device_id");--> statement-breakpoint
CREATE INDEX "nas_nasname" ON "nas" USING btree ("nasname" text_ops);--> statement-breakpoint
CREATE INDEX "radacct_usage_pending_idx" ON "radacct" USING btree ("class","radacctid") WHERE "radacct"."acctstarttime" is not null and (
                "radacct"."usage_captured_input_octets" is null or
                "radacct"."usage_captured_output_octets" is null or
                "radacct"."acctinputoctets" > "radacct"."usage_captured_input_octets" or
                "radacct"."acctoutputoctets" > "radacct"."usage_captured_output_octets"
            );--> statement-breakpoint
CREATE INDEX "radacct_active_session_idx" ON "radacct" USING btree ("acctuniqueid" text_ops) WHERE (acctstoptime IS NULL);--> statement-breakpoint
CREATE INDEX "radacct_bulk_close" ON "radacct" USING btree ("nasipaddress" inet_ops,"acctstarttime" timestamptz_ops) WHERE (acctstoptime IS NULL);--> statement-breakpoint
CREATE INDEX "radacct_calss_idx" ON "radacct" USING btree ("class" text_ops);--> statement-breakpoint
CREATE INDEX "radacct_start_user_idx" ON "radacct" USING btree ("acctstarttime" timestamptz_ops,"username" text_ops);--> statement-breakpoint
CREATE INDEX "radcheck_username" ON "radcheck" USING btree ("username" text_ops,"attribute" text_ops);--> statement-breakpoint
CREATE INDEX "radgroupcheck_groupname" ON "radgroupcheck" USING btree ("groupname" text_ops,"attribute" text_ops);--> statement-breakpoint
CREATE INDEX "radgroupreply_groupname" ON "radgroupreply" USING btree ("groupname" text_ops,"attribute" text_ops);--> statement-breakpoint
CREATE INDEX "radpostauth_class_idx" ON "radpostauth" USING btree ("class" text_ops);--> statement-breakpoint
CREATE INDEX "radpostauth_username_idx" ON "radpostauth" USING btree ("username" text_ops);--> statement-breakpoint
CREATE INDEX "radreply_username" ON "radreply" USING btree ("username" text_ops,"attribute" text_ops);--> statement-breakpoint
CREATE INDEX "radusergroup_username" ON "radusergroup" USING btree ("username" text_ops);--> statement-breakpoint
CREATE INDEX "package_audience_owner_idx" ON "package_audience" USING btree ("owner_id");