CREATE TYPE "public"."day_off_kind" AS ENUM('feriado', 'vacaciones', 'otro');--> statement-breakpoint
CREATE TABLE "school_days_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "day_off_kind" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_days_off_dates" CHECK ("school_days_off"."ends_on" >= "school_days_off"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "language" text DEFAULT 'es' NOT NULL;--> statement-breakpoint
ALTER TABLE "school_days_off" ADD CONSTRAINT "school_days_off_year_fk" FOREIGN KEY ("school_id","school_year_id") REFERENCES "public"."school_years"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_days_off_dates_idx" ON "school_days_off" USING btree ("school_id","starts_on");--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_language" CHECK ("subjects"."language" in ('es', 'en'));