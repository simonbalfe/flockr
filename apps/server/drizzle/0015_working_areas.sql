CREATE TABLE "working_areas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "working_areas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel" text NOT NULL,
	"owner" text NOT NULL,
	"task_id" integer,
	"paths" text[] NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"released_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_areas_reason" CHECK ("working_areas"."released_reason" is null or "working_areas"."released_reason" in ('released', 'task_ended', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "working_areas" ADD CONSTRAINT "working_areas_channel_channels_id_fk" FOREIGN KEY ("channel") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_areas" ADD CONSTRAINT "working_areas_owner_members_name_fk" FOREIGN KEY ("owner") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_areas" ADD CONSTRAINT "working_areas_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "working_areas_live" ON "working_areas" USING btree ("channel") WHERE "working_areas"."released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "working_areas_one_per_task" ON "working_areas" USING btree ("task_id") WHERE "working_areas"."released_at" is null and "working_areas"."task_id" is not null;