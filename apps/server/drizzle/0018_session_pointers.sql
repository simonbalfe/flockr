CREATE TABLE "session_pointers" (
	"agent" text NOT NULL,
	"session" text NOT NULL,
	"thread" text,
	"epoch" integer DEFAULT 0 NOT NULL,
	"fence" text NOT NULL,
	"task_id" integer,
	"chunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_pointers_agent_session_pk" PRIMARY KEY("agent","session")
);
--> statement-breakpoint
ALTER TABLE "session_pointers" ADD CONSTRAINT "session_pointers_agent_members_name_fk" FOREIGN KEY ("agent") REFERENCES "public"."members"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_pointers_thread" ON "session_pointers" USING btree ("agent","thread","updated_at");