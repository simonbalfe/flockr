ALTER TABLE "members" ADD COLUMN "access" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "access_grants" text[];--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_access" CHECK ("members"."access" in ('read', 'reply', 'full', 'custom'));