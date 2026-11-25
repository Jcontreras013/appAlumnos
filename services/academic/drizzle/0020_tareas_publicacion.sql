ALTER TABLE "class_tasks" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
-- Las tareas que ya existían quedan publicadas desde que se crearon.
UPDATE "class_tasks" SET "publish_at" = "created_at";
