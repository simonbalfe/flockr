CREATE TABLE "channel_members" (
	"channel" text NOT NULL,
	"member" text NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_members_channel_member_pk" PRIMARY KEY("channel","member")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"host" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "orgs" ("id", "name", "host") VALUES ('home', 'Home', true);--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "org" text DEFAULT 'home' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "visibility" text DEFAULT 'org' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "org" text DEFAULT 'home' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channel_channels_id_fk" FOREIGN KEY ("channel") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_member_members_name_fk" FOREIGN KEY ("member") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_members_member" ON "channel_members" USING btree ("member");--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_one_host" ON "orgs" USING btree ("host") WHERE "orgs"."host";--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_org_orgs_id_fk" FOREIGN KEY ("org") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_org_orgs_id_fk" FOREIGN KEY ("org") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channels_org" ON "channels" USING btree ("org");--> statement-breakpoint
CREATE INDEX "members_org" ON "members" USING btree ("org");--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_visibility" CHECK ("channels"."visibility" in ('org', 'private', 'shared'));--> statement-breakpoint
INSERT INTO "channel_members" ("channel", "member") SELECT "channel", "member" FROM "direct_members";--> statement-breakpoint
UPDATE "channels" SET "visibility" = 'private' WHERE "kind" = 'dm';