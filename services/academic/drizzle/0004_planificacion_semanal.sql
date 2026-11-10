CREATE TYPE "public"."plan_action" AS ENUM('creada', 'guardada', 'enviada', 'aprobada', 'devuelta');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('borrador', 'enviada', 'devuelta', 'aprobada');--> statement-breakpoint
CREATE TABLE "lesson_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" "plan_status" DEFAULT 'borrador' NOT NULL,
	"fields" jsonb NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"author_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewer_user_id" uuid,
	"reviewer_name" text,
	"review_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_plans_tenant_key" UNIQUE("school_id","id"),
	CONSTRAINT "lesson_plans_monday" CHECK (extract(isodow from "lesson_plans"."week_start") = 1)
);
--> statement-breakpoint
CREATE TABLE "plan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"action" "plan_action" NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"comment" text,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_templates" (
	"school_id" uuid PRIMARY KEY NOT NULL,
	"fields" jsonb NOT NULL,
	"deadline_days_before" integer NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_templates_deadline" CHECK ("plan_templates"."deadline_days_before" between 0 and 14)
);
--> statement-breakpoint
ALTER TABLE "lesson_plans" ADD CONSTRAINT "lesson_plans_assignment_fk" FOREIGN KEY ("school_id","assignment_id") REFERENCES "public"."teaching_assignments"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_plan_fk" FOREIGN KEY ("school_id","plan_id") REFERENCES "public"."lesson_plans"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_plans_assignment_week_key" ON "lesson_plans" USING btree ("assignment_id","week_start");--> statement-breakpoint
CREATE INDEX "lesson_plans_school_week_idx" ON "lesson_plans" USING btree ("school_id","week_start");--> statement-breakpoint
CREATE INDEX "plan_events_plan_idx" ON "plan_events" USING btree ("plan_id","created_at");