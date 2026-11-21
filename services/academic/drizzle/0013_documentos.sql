CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"title" text NOT NULL,
	"template" text NOT NULL,
	"content" jsonb NOT NULL,
	"visibility" text DEFAULT 'privado' NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_visibility" CHECK ("documents"."visibility" in ('privado', 'personal'))
);
--> statement-breakpoint
CREATE INDEX "documents_author_idx" ON "documents" USING btree ("school_id","author_user_id");--> statement-breakpoint
CREATE INDEX "documents_shared_idx" ON "documents" USING btree ("school_id","visibility");