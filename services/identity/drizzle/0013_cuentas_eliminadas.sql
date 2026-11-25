ALTER TABLE "users" DROP CONSTRAINT "users_login_identifier";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_identifier" CHECK ("users"."email" is not null or "users"."national_id" is not null or "users"."deleted_at" is not null);