CREATE TABLE "agents" (
	"name" text PRIMARY KEY NOT NULL,
	"harness" text NOT NULL,
	"folder" text NOT NULL,
	"machine" text NOT NULL,
	"permissions" text NOT NULL,
	"personality" text,
	"desired" text NOT NULL,
	"reported" text,
	"reported_reason" text,
	"reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_permissions" CHECK ("agents"."permissions" in ('edit-free-commands-ask', 'read-only')),
	CONSTRAINT "agents_desired" CHECK ("agents"."desired" in ('running', 'stopped')),
	CONSTRAINT "agents_reported" CHECK ("agents"."reported" is null or "agents"."reported" in ('serving', 'working', 'error'))
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"harnesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"announced_online" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_name_members_name_fk" FOREIGN KEY ("name") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_machine_machines_id_fk" FOREIGN KEY ("machine") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_machine" ON "agents" USING btree ("machine");