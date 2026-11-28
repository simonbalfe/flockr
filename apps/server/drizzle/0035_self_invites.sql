ALTER TABLE "orgs" ADD COLUMN "self_invites" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "owner" text;