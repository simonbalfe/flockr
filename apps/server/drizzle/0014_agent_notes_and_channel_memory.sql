CREATE TABLE "memory_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "memory_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scope" text NOT NULL,
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_thread" text,
	"key" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "memory_items_scope" CHECK ("memory_items"."scope" in ('agent', 'channel')),
	CONSTRAINT "memory_items_kind" CHECK ("memory_items"."kind" in ('dead-end', 'decision', 'preference', 'fact', 'todo'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "memory_items_key" ON "memory_items" USING btree ("scope","owner","key") WHERE "memory_items"."key" is not null;--> statement-breakpoint
CREATE INDEX "memory_items_owner" ON "memory_items" USING btree ("scope","owner","id");