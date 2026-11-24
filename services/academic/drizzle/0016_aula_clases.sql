CREATE TABLE "class_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"file_name" text,
	"content_type" text,
	"size_bytes" integer,
	"storage_key" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_materials_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "class_materials_kind" CHECK ("class_materials"."kind" in ('archivo', 'enlace', 'video')),
	CONSTRAINT "class_materials_content" CHECK (("class_materials"."kind" in ('enlace', 'video') and "class_materials"."url" is not null and "class_materials"."storage_key" is null) or ("class_materials"."kind" = 'archivo' and "class_materials"."storage_key" is not null and "class_materials"."size_bytes" > 0))
);
--> statement-breakpoint
CREATE TABLE "class_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_posts_tenant_key" UNIQUE("school_id","id"),
	CONSTRAINT "class_posts_kind" CHECK ("class_posts"."kind" in ('tema', 'aviso'))
);
--> statement-breakpoint
CREATE TABLE "virtual_classes" (
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"meeting_url" text,
	"meeting_note" text,
	"updated_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "virtual_classes_pk" PRIMARY KEY("assignment_id")
);
--> statement-breakpoint
ALTER TABLE "class_materials" ADD CONSTRAINT "class_materials_post_fk" FOREIGN KEY ("school_id","post_id") REFERENCES "public"."class_posts"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_posts" ADD CONSTRAINT "class_posts_assignment_fk" FOREIGN KEY ("school_id","assignment_id") REFERENCES "public"."teaching_assignments"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_classes" ADD CONSTRAINT "virtual_classes_assignment_fk" FOREIGN KEY ("school_id","assignment_id") REFERENCES "public"."teaching_assignments"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_materials_post_idx" ON "class_materials" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "class_posts_assignment_idx" ON "class_posts" USING btree ("assignment_id","kind","position");