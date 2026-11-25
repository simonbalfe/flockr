CREATE TABLE "activity" (
	"member" text NOT NULL,
	"thread_id" text NOT NULL,
	"channel" text NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "activity_member_thread_id_pk" PRIMARY KEY("member","thread_id")
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_kind";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mentions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "question" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "answered_by" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_member_members_name_fk" FOREIGN KEY ("member") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_channel_channels_id_fk" FOREIGN KEY ("channel") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_question" CHECK (("messages"."kind" = 'question') = ("messages"."question" is not null));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind" CHECK ("messages"."kind" in ('text', 'task', 'ask', 'event', 'question'));