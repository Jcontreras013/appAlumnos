CREATE TYPE "public"."transfer_status" AS ENUM('pendiente', 'recibido', 'cancelado');--> statement-breakpoint
CREATE TABLE "student_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_school_id" uuid NOT NULL,
	"from_school_name" text NOT NULL,
	"from_student_id" uuid NOT NULL,
	"to_school_id" uuid NOT NULL,
	"to_school_name" text NOT NULL,
	"to_student_id" uuid,
	"status" "transfer_status" DEFAULT 'pendiente' NOT NULL,
	"date" date NOT NULL,
	"notes" text,
	"snapshot" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "student_transfers" ADD CONSTRAINT "student_transfers_from_student_fk" FOREIGN KEY ("from_school_id","from_student_id") REFERENCES "public"."students"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_transfers_from_idx" ON "student_transfers" USING btree ("from_school_id","status");--> statement-breakpoint
CREATE INDEX "student_transfers_to_idx" ON "student_transfers" USING btree ("to_school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "student_transfers_one_pending" ON "student_transfers" USING btree ("from_school_id","from_student_id") WHERE "student_transfers"."status" = 'pendiente';