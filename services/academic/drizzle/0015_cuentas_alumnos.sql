ALTER TABLE "students" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "students_user_unique" ON "students" USING btree ("school_id","user_id") WHERE "students"."user_id" is not null;