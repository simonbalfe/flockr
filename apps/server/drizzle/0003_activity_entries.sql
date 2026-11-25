ALTER TABLE "messages" DROP CONSTRAINT "messages_kind";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "activity" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_activity" CHECK (("messages"."kind" = 'activity') = ("messages"."activity" is not null));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind" CHECK ("messages"."kind" in ('text', 'task', 'ask', 'event', 'question', 'activity'));