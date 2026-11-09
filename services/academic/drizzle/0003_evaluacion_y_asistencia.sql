CREATE TYPE "public"."attendance_status" AS ENUM('presente', 'ausente', 'tarde', 'justificada');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"name" text NOT NULL,
	"max_points" numeric(5, 2) NOT NULL,
	"date" date NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_tenant_key" UNIQUE("school_id","id"),
	CONSTRAINT "activities_points" CHECK ("activities"."max_points" > 0 and "activities"."max_points" <= 100)
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"school_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"date" date NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "attendance_status" NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_pk" PRIMARY KEY("section_id","date","student_id")
);
--> statement-breakpoint
CREATE TABLE "evaluation_settings" (
	"school_id" uuid PRIMARY KEY NOT NULL,
	"passing_grade" integer DEFAULT 70 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grading_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"closes_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grading_periods_tenant_key" UNIQUE("school_id","id"),
	CONSTRAINT "grading_periods_number_unique" UNIQUE("school_year_id","number"),
	CONSTRAINT "grading_periods_dates" CHECK ("grading_periods"."starts_on" <= "grading_periods"."ends_on" and "grading_periods"."ends_on" <= "grading_periods"."closes_on")
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"school_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"points" numeric(5, 2),
	"updated_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scores_pk" PRIMARY KEY("activity_id","student_id"),
	CONSTRAINT "scores_points" CHECK ("scores"."points" is null or "scores"."points" >= 0)
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_assignment_fk" FOREIGN KEY ("school_id","assignment_id") REFERENCES "public"."teaching_assignments"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_period_fk" FOREIGN KEY ("school_id","period_id") REFERENCES "public"."grading_periods"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_section_fk" FOREIGN KEY ("school_id","section_id") REFERENCES "public"."sections"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_student_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_periods" ADD CONSTRAINT "grading_periods_school_year_fk" FOREIGN KEY ("school_id","school_year_id") REFERENCES "public"."school_years"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_activity_fk" FOREIGN KEY ("school_id","activity_id") REFERENCES "public"."activities"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_student_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_assignment_period_idx" ON "activities" USING btree ("assignment_id","period_id");--> statement-breakpoint
CREATE INDEX "attendance_school_date_idx" ON "attendance_records" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "attendance_student_idx" ON "attendance_records" USING btree ("student_id","date");