CREATE TABLE "direct_members" (
	"channel" text NOT NULL,
	"member" text NOT NULL,
	CONSTRAINT "direct_members_channel_member_pk" PRIMARY KEY("channel","member")
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"member" text NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"channel" text NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_member_kind_target_pk" PRIMARY KEY("member","kind","target"),
	CONSTRAINT "drafts_kind" CHECK ("drafts"."kind" in ('channel', 'thread'))
);
--> statement-breakpoint
CREATE TABLE "saved_messages" (
	"member" text NOT NULL,
	"message_id" integer NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_messages_member_message_id_pk" PRIMARY KEY("member","message_id")
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "kind" text DEFAULT 'channel' NOT NULL;--> statement-breakpoint
ALTER TABLE "direct_members" ADD CONSTRAINT "direct_members_channel_channels_id_fk" FOREIGN KEY ("channel") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_members" ADD CONSTRAINT "direct_members_member_members_name_fk" FOREIGN KEY ("member") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_member_members_name_fk" FOREIGN KEY ("member") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_channel_channels_id_fk" FOREIGN KEY ("channel") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_messages" ADD CONSTRAINT "saved_messages_member_members_name_fk" FOREIGN KEY ("member") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_messages" ADD CONSTRAINT "saved_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "direct_members_member" ON "direct_members" USING btree ("member");--> statement-breakpoint
CREATE INDEX "messages_who" ON "messages" USING btree ("who","id");--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_kind" CHECK ("channels"."kind" in ('channel', 'dm'));