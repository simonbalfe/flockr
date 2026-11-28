ALTER TABLE "member_keys" ADD COLUMN "kind" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_keys" ADD COLUMN "made_by_key" text;--> statement-breakpoint
ALTER TABLE "member_keys" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_keys" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_keys" ADD CONSTRAINT "member_keys_made_by_key_member_keys_id_fk" FOREIGN KEY ("made_by_key") REFERENCES "public"."member_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_keys_made_by_key" ON "member_keys" USING btree ("made_by_key");--> statement-breakpoint
ALTER TABLE "member_keys" ADD CONSTRAINT "member_keys_kind" CHECK ("member_keys"."kind" in ('member', 'provisioning'));