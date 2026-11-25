CREATE TABLE "message_versions" (
	"message_id" integer NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"mentions" text[] DEFAULT '{}'::text[] NOT NULL,
	"written_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_versions_message_id_version_pk" PRIMARY KEY("message_id","version")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_to_id" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "labels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_versions" ADD CONSTRAINT "message_versions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;