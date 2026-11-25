CREATE TABLE "jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"routine_id" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"locked_until" timestamp with time zone,
	"result" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_state" CHECK ("jobs"."state" in ('queued', 'running', 'done', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "routines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"trigger_kind" text NOT NULL,
	"schedule" text,
	"event_type" text,
	"action" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"per_hour" integer NOT NULL,
	"next_run_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "routines_trigger" CHECK (("routines"."trigger_kind" = 'cron' and "routines"."schedule" is not null and "routines"."event_type" is null) or ("routines"."trigger_kind" = 'event' and "routines"."event_type" is not null and "routines"."schedule" is null)),
	CONSTRAINT "routines_per_hour" CHECK ("routines"."per_hour" > 0)
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_channel_channels_id_fk" FOREIGN KEY ("channel") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_key" ON "jobs" USING btree ("key");--> statement-breakpoint
CREATE INDEX "jobs_due" ON "jobs" USING btree ("run_at","id") WHERE "jobs"."state" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_stuck" ON "jobs" USING btree ("locked_until") WHERE "jobs"."state" = 'running';--> statement-breakpoint
CREATE INDEX "jobs_routine" ON "jobs" USING btree ("routine_id","id");--> statement-breakpoint
CREATE INDEX "jobs_fired" ON "jobs" USING btree ("finished_at") WHERE "jobs"."state" = 'done';--> statement-breakpoint
CREATE INDEX "routines_watch" ON "routines" USING btree ("channel","event_type") WHERE "routines"."enabled" and "routines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "routines_due" ON "routines" USING btree ("next_run_at") WHERE "routines"."enabled" and "routines"."deleted_at" is null;