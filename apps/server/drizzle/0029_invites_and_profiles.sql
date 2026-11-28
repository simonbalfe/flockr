CREATE TABLE "invites" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "invites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"member" text NOT NULL,
	"org" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_emails" (
	"email" text PRIMARY KEY NOT NULL,
	"member" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "colour" text;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_orgs_id_fk" FOREIGN KEY ("org") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_members_name_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_emails" ADD CONSTRAINT "member_emails_member_members_name_fk" FOREIGN KEY ("member") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_email" ON "invites" USING btree ("email");