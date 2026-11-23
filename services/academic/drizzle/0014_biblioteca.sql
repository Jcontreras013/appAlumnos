CREATE TABLE "library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text,
	"file_name" text,
	"content_type" text,
	"size_bytes" integer,
	"storage_key" text,
	"grade_id" uuid,
	"subject_id" uuid,
	"audience" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"uploaded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_items_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "library_items_kind" CHECK ("library_items"."kind" in ('archivo', 'enlace')),
	CONSTRAINT "library_items_audience" CHECK ("library_items"."audience" in ('personal', 'familias')),
	CONSTRAINT "library_items_content" CHECK (("library_items"."kind" = 'enlace' and "library_items"."url" is not null and "library_items"."storage_key" is null) or ("library_items"."kind" = 'archivo' and "library_items"."storage_key" is not null and "library_items"."size_bytes" > 0))
);
--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_grade_fk" FOREIGN KEY ("school_id","grade_id") REFERENCES "public"."grades"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_subject_fk" FOREIGN KEY ("school_id","subject_id") REFERENCES "public"."subjects"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_items_school_idx" ON "library_items" USING btree ("school_id","created_at");