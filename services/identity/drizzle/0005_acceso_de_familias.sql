ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "national_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_national_id_unique" UNIQUE("national_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_identifier" CHECK ("users"."email" is not null or "users"."national_id" is not null);