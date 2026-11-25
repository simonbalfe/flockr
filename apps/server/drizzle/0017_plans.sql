CREATE TABLE "plans" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "plans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel" text NOT NULL,
	"title" text NOT NULL,
	"goal" text,
	"key" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_id" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_channel_channels_id_fk" FOREIGN KEY ("channel") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_created_by_members_name_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_key" ON "plans" USING btree ("channel","key") WHERE "plans"."key" is not null;--> statement-breakpoint
CREATE INDEX "plans_open" ON "plans" USING btree ("channel","id") WHERE "plans"."closed_at" is null;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_plan" ON "tasks" USING btree ("plan_id");