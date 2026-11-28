CREATE TABLE "bridge_channels" (
	"bridge" text NOT NULL,
	"channel" text NOT NULL,
	"external" text NOT NULL,
	"linked_by" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_channels_bridge_channel_pk" PRIMARY KEY("bridge","channel")
);
--> statement-breakpoint
CREATE TABLE "bridge_messages" (
	"bridge" text NOT NULL,
	"message" integer NOT NULL,
	"external_channel" text NOT NULL,
	"external_ts" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_messages_bridge_message_pk" PRIMARY KEY("bridge","message")
);
--> statement-breakpoint
CREATE TABLE "bridge_people" (
	"bridge" text NOT NULL,
	"member" text NOT NULL,
	"external" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_people_bridge_member_pk" PRIMARY KEY("bridge","member")
);
--> statement-breakpoint
CREATE TABLE "bridge_threads" (
	"bridge" text NOT NULL,
	"thread" text NOT NULL,
	"external_channel" text NOT NULL,
	"external_thread" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_threads_bridge_thread_pk" PRIMARY KEY("bridge","thread")
);
--> statement-breakpoint
ALTER TABLE "bridge_channels" ADD CONSTRAINT "bridge_channels_channel_channels_id_fk" FOREIGN KEY ("channel") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_channels" ADD CONSTRAINT "bridge_channels_linked_by_members_name_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."members"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_messages" ADD CONSTRAINT "bridge_messages_message_messages_id_fk" FOREIGN KEY ("message") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_people" ADD CONSTRAINT "bridge_people_member_members_name_fk" FOREIGN KEY ("member") REFERENCES "public"."members"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_channels_external" ON "bridge_channels" USING btree ("bridge","external");--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_messages_external" ON "bridge_messages" USING btree ("bridge","external_channel","external_ts");--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_people_external" ON "bridge_people" USING btree ("bridge","external");--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_threads_external" ON "bridge_threads" USING btree ("bridge","external_channel","external_thread");