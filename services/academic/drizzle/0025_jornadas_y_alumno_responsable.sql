CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"class_days" integer[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_tenant_key" UNIQUE("school_id","id"),
	CONSTRAINT "shifts_name_unique" UNIQUE("school_id","name")
);
--> statement-breakpoint
ALTER TABLE "schedule_slots" DROP CONSTRAINT "schedule_slots_weekday";--> statement-breakpoint
ALTER TABLE "schedule_blocks" DROP CONSTRAINT "schedule_blocks_pk";--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "self_responsible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_shift_fk" FOREIGN KEY ("school_id","shift_id") REFERENCES "public"."shifts"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_shift_fk" FOREIGN KEY ("school_id","shift_id") REFERENCES "public"."shifts"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_blocks_number_unique" ON "schedule_blocks" USING btree ("school_id",coalesce("shift_id", '00000000-0000-0000-0000-000000000000'::uuid),"number");--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_weekday" CHECK ("schedule_slots"."weekday" between 1 and 7);