ALTER TABLE "agents" DROP CONSTRAINT "agents_desired";--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_desired" CHECK ("agents"."desired" in ('running', 'paused', 'stopped'));