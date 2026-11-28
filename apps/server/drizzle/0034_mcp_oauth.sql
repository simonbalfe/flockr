CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oauth_grants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"code_hash" text NOT NULL,
	"user_code" text,
	"client" text NOT NULL,
	"redirect_uri" text,
	"code_challenge" text,
	"state" text NOT NULL,
	"member" text,
	"channels" text[],
	"approved_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_grants_kind" CHECK ("oauth_grants"."kind" in ('code', 'device')),
	CONSTRAINT "oauth_grants_state" CHECK ("oauth_grants"."state" in ('pending', 'approved', 'denied', 'used'))
);
--> statement-breakpoint
ALTER TABLE "member_keys" ADD COLUMN "oauth_client" text;--> statement-breakpoint
ALTER TABLE "member_keys" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_oauth_clients_id_fk" FOREIGN KEY ("client") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_member_members_name_fk" FOREIGN KEY ("member") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_approved_by_members_name_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_code_hash" ON "oauth_grants" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_pending_user_code" ON "oauth_grants" USING btree ("user_code") WHERE "oauth_grants"."state" = 'pending';--> statement-breakpoint
ALTER TABLE "member_keys" ADD CONSTRAINT "member_keys_oauth_client_oauth_clients_id_fk" FOREIGN KEY ("oauth_client") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;