CREATE TABLE "approval_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "approval_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"channel" text,
	"verdict" text NOT NULL,
	"set_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_rules_scope" UNIQUE NULLS NOT DISTINCT("kind","channel"),
	CONSTRAINT "approval_rules_verdict" CHECK ("approval_rules"."verdict" in ('allow', 'ask', 'block'))
);
--> statement-breakpoint
CREATE TABLE "job_approvals" (
	"job_id" integer PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"question_id" integer NOT NULL,
	"answer" text,
	"answered_by" text,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_state";--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_channel_channels_id_fk" FOREIGN KEY ("channel") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_approvals" ADD CONSTRAINT "job_approvals_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_approvals" ADD CONSTRAINT "job_approvals_channel_channels_id_fk" FOREIGN KEY ("channel") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_approvals" ADD CONSTRAINT "job_approvals_question_id_messages_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_approvals_question" ON "job_approvals" USING btree ("question_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_state" CHECK ("jobs"."state" in ('queued', 'running', 'waiting', 'done', 'failed', 'skipped'));