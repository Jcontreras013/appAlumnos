CREATE TYPE "public"."leave_type" AS ENUM('vacaciones', 'enfermedad', 'maternidad', 'capacitacion', 'personal', 'otra');--> statement-breakpoint
CREATE TABLE "substitutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"leave_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"substitute_user_id" uuid NOT NULL,
	"substitute_name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "substitutions_tenant_key" UNIQUE("school_id","id"),
	CONSTRAINT "substitutions_dates" CHECK ("substitutions"."ends_on" >= "substitutions"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "teacher_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"teacher_user_id" uuid NOT NULL,
	"teacher_name" text NOT NULL,
	"type" "leave_type" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_leaves_tenant_key" UNIQUE("school_id","id"),
	CONSTRAINT "teacher_leaves_dates" CHECK ("teacher_leaves"."ends_on" >= "teacher_leaves"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_leave_fk" FOREIGN KEY ("school_id","leave_id") REFERENCES "public"."teacher_leaves"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_assignment_fk" FOREIGN KEY ("school_id","assignment_id") REFERENCES "public"."teaching_assignments"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "substitutions_active_unique" ON "substitutions" USING btree ("leave_id","assignment_id") WHERE "substitutions"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "substitutions_substitute_idx" ON "substitutions" USING btree ("school_id","substitute_user_id");--> statement-breakpoint
CREATE INDEX "teacher_leaves_teacher_idx" ON "teacher_leaves" USING btree ("school_id","teacher_user_id");