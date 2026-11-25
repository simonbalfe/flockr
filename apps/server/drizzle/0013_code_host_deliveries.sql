CREATE TABLE "hook_deliveries" (
	"host" text NOT NULL,
	"delivery" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hook_deliveries_host_delivery_pk" PRIMARY KEY("host","delivery")
);
