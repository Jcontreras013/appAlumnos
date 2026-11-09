CREATE TYPE "public"."school_sector" AS ENUM('publico', 'privado');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'director_departamental' BEFORE 'admin';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'director_distrital' BEFORE 'admin';--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "districts_name_unique" UNIQUE("department_id","name")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"school_id" uuid,
	"district_id" uuid,
	"department_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_unique" UNIQUE NULLS NOT DISTINCT("user_id","role","school_id","district_id","department_id"),
	CONSTRAINT "memberships_scope_matches_role" CHECK (case "memberships"."role"::text
        when 'superadmin' then "memberships"."school_id" is null and "memberships"."district_id" is null and "memberships"."department_id" is null
        when 'director_departamental' then "memberships"."department_id" is not null and "memberships"."school_id" is null and "memberships"."district_id" is null
        when 'director_distrital' then "memberships"."district_id" is not null and "memberships"."school_id" is null and "memberships"."department_id" is null
        else "memberships"."school_id" is not null and "memberships"."district_id" is null and "memberships"."department_id" is null
      end)
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_superadmin_has_no_school";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_school_id_schools_id_fk";
--> statement-breakpoint
DROP INDEX "users_school_idx";--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "membership_id" uuid;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "sector" "school_sector" DEFAULT 'privado' NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "district_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_school_idx" ON "memberships" USING btree ("school_id");--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_membership_idx" ON "refresh_tokens" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "schools_district_idx" ON "schools" USING btree ("district_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schools_code_unique" ON "schools" USING btree ("code") WHERE "schools"."code" is not null;--> statement-breakpoint
-- Migración de datos: cada usuario existente pasa a tener una membresía con su rol y su colegio,
-- y sus sesiones abiertas quedan ligadas a ella (nadie tiene que volver a iniciar sesión).
INSERT INTO "memberships" ("user_id", "role", "school_id")
  SELECT "id", "role", "school_id" FROM "users";--> statement-breakpoint
UPDATE "refresh_tokens" rt SET "membership_id" = m."id"
  FROM "memberships" m WHERE m."user_id" = rt."user_id";--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "membership_id" SET NOT NULL;--> statement-breakpoint
UPDATE "users" u SET "last_membership_id" = m."id"
  FROM "memberships" m WHERE m."user_id" = u."id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "school_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";