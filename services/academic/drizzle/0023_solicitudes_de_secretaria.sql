CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_by_name" text NOT NULL,
	"decided_by_user_id" uuid,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"result_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_requests_kind" CHECK ("change_requests"."kind" in ('grado', 'seccion', 'materia', 'licencia')),
	CONSTRAINT "change_requests_status" CHECK ("change_requests"."status" in ('pendiente', 'aprobada', 'rechazada'))
);
--> statement-breakpoint
CREATE INDEX "change_requests_school_status_idx" ON "change_requests" USING btree ("school_id","status","created_at");