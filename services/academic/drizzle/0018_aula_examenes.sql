CREATE TABLE "class_quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"activity_id" uuid,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"time_limit_minutes" integer,
	"shuffle" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_quizzes_tenant_key" UNIQUE("school_id","id"),
	CONSTRAINT "class_quizzes_window" CHECK ("class_quizzes"."closes_at" > "class_quizzes"."opens_at")
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"quiz_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" uuid,
	"submitted_by_name" text,
	"raw_score" numeric(6, 2),
	"score" numeric(5, 2),
	"graded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_attempts_one_per_student" UNIQUE("quiz_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"quiz_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correct" jsonb,
	"points" numeric(5, 2) NOT NULL,
	CONSTRAINT "quiz_questions_kind" CHECK ("quiz_questions"."kind" in ('opcion', 'vf', 'abierta'))
);
--> statement-breakpoint
ALTER TABLE "class_quizzes" ADD CONSTRAINT "class_quizzes_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_quizzes" ADD CONSTRAINT "class_quizzes_assignment_fk" FOREIGN KEY ("school_id","assignment_id") REFERENCES "public"."teaching_assignments"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_fk" FOREIGN KEY ("school_id","quiz_id") REFERENCES "public"."class_quizzes"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_student_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_fk" FOREIGN KEY ("school_id","quiz_id") REFERENCES "public"."class_quizzes"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_quizzes_assignment_idx" ON "class_quizzes" USING btree ("assignment_id","opens_at");--> statement-breakpoint
CREATE INDEX "quiz_questions_quiz_idx" ON "quiz_questions" USING btree ("quiz_id","position");