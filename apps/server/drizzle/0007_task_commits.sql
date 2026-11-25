CREATE TABLE "task_commits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_commits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"sha" text NOT NULL,
	"message" text,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "repo" text;--> statement-breakpoint
ALTER TABLE "task_commits" ADD CONSTRAINT "task_commits_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_commits_task_sha" ON "task_commits" USING btree ("task_id","sha");--> statement-breakpoint
INSERT INTO "task_commits" ("task_id", "sha", "added_by", "added_at") SELECT "id", lower(trim("commit")), coalesce("holder", "assignee", 'flockr'), "updated_at" FROM "tasks" WHERE "commit" IS NOT NULL AND trim("commit") <> '' ORDER BY "id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "commit";