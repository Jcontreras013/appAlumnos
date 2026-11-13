CREATE TYPE "public"."follow_up_kind" AS ENUM('llamada', 'reunion', 'visita', 'orientacion', 'compromiso', 'otro');--> statement-breakpoint
CREATE TABLE "student_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" "follow_up_kind" NOT NULL,
	"date" date NOT NULL,
	"notes" text NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_follow_ups_tenant_key" UNIQUE("school_id","id")
);
--> statement-breakpoint
ALTER TABLE "student_follow_ups" ADD CONSTRAINT "student_follow_ups_student_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_follow_ups_student_idx" ON "student_follow_ups" USING btree ("school_id","student_id","date");