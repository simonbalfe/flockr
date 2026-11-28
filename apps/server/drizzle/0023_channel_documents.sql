CREATE TABLE "channel_document_versions" (
	"channel" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"note" text,
	"written_by" text NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_document_versions_channel_version_pk" PRIMARY KEY("channel","version"),
	CONSTRAINT "channel_document_versions_version" CHECK ("channel_document_versions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "channel_document_versions" ADD CONSTRAINT "channel_document_versions_channel_channels_id_fk" FOREIGN KEY ("channel") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_document_versions" ADD CONSTRAINT "channel_document_versions_written_by_members_name_fk" FOREIGN KEY ("written_by") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;