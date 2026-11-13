CREATE TABLE "recovery_grades" (
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_grades_pk" PRIMARY KEY("assignment_id","student_id"),
	CONSTRAINT "recovery_grades_score" CHECK ("recovery_grades"."score" >= 0 and "recovery_grades"."score" <= 100)
);
--> statement-breakpoint
ALTER TABLE "recovery_grades" ADD CONSTRAINT "recovery_grades_assignment_fk" FOREIGN KEY ("school_id","assignment_id") REFERENCES "public"."teaching_assignments"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_grades" ADD CONSTRAINT "recovery_grades_student_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE no action ON UPDATE no action;