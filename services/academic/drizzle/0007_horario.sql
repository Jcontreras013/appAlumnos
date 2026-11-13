CREATE TABLE "schedule_blocks" (
	"school_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	CONSTRAINT "schedule_blocks_pk" PRIMARY KEY("school_id","number")
);
--> statement-breakpoint
CREATE TABLE "schedule_slots" (
	"school_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"block" integer NOT NULL,
	"assignment_id" uuid NOT NULL,
	CONSTRAINT "schedule_slots_pk" PRIMARY KEY("section_id","weekday","block"),
	CONSTRAINT "schedule_slots_weekday" CHECK ("schedule_slots"."weekday" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_section_fk" FOREIGN KEY ("school_id","section_id") REFERENCES "public"."sections"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_assignment_fk" FOREIGN KEY ("school_id","assignment_id") REFERENCES "public"."teaching_assignments"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_slots_assignment_idx" ON "schedule_slots" USING btree ("assignment_id");