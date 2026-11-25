ALTER TABLE "quiz_attempts" ADD COLUMN "comments" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "feedback" text;