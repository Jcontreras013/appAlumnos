CREATE TABLE "class_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"activity_id" uuid,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"allow_late" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_tasks_tenant_key" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "task_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"submission_id" uuid,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "task_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" uuid,
	"submitted_by_name" text,
	"late" boolean DEFAULT false NOT NULL,
	"points" numeric(5, 2),
	"feedback" text,
	"graded_at" timestamp with time zone,
	"graded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_submissions_tenant_key" UNIQUE("school_id","id"),
	CONSTRAINT "task_submissions_one_per_student" UNIQUE("task_id","student_id")
);
--> statement-breakpoint
ALTER TABLE "class_tasks" ADD CONSTRAINT "class_tasks_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_tasks" ADD CONSTRAINT "class_tasks_assignment_fk" FOREIGN KEY ("school_id","assignment_id") REFERENCES "public"."teaching_assignments"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_task_fk" FOREIGN KEY ("school_id","task_id") REFERENCES "public"."class_tasks"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_submission_fk" FOREIGN KEY ("school_id","submission_id") REFERENCES "public"."task_submissions"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_task_fk" FOREIGN KEY ("school_id","task_id") REFERENCES "public"."class_tasks"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_student_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_tasks_assignment_idx" ON "class_tasks" USING btree ("assignment_id","due_at");--> statement-breakpoint
CREATE INDEX "task_files_task_idx" ON "task_files" USING btree ("task_id","submission_id");