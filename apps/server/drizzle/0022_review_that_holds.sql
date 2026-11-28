ALTER TABLE "channels" ADD COLUMN "review_needs_person" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reviewer" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "review_commit" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewer_members_name_fk" FOREIGN KEY ("reviewer") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_reviewer" ON "tasks" USING btree ("reviewer","state");