CREATE TYPE "public"."discipline_kind" AS ENUM('llamado_verbal', 'llamado_escrito', 'citacion', 'compromiso', 'suspension', 'expulsion');--> statement-breakpoint
CREATE TYPE "public"."discipline_severity" AS ENUM('leve', 'grave', 'muy_grave');--> statement-breakpoint
CREATE TABLE "discipline_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" "discipline_kind" NOT NULL,
	"severity" "discipline_severity" NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"measure" text,
	"suspension_from" date,
	"suspension_to" date,
	"notify_family" boolean DEFAULT false NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discipline_records_tenant_key" UNIQUE("school_id","id"),
	CONSTRAINT "discipline_records_suspension_dates" CHECK ("discipline_records"."kind" <> 'suspension' OR ("discipline_records"."suspension_from" IS NOT NULL AND "discipline_records"."suspension_to" >= "discipline_records"."suspension_from"))
);
--> statement-breakpoint
ALTER TABLE "discipline_records" ADD CONSTRAINT "discipline_records_student_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discipline_records_student_idx" ON "discipline_records" USING btree ("school_id","student_id","date");--> statement-breakpoint
CREATE INDEX "discipline_records_school_date_idx" ON "discipline_records" USING btree ("school_id","date");