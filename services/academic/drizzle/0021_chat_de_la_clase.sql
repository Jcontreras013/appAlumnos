CREATE TABLE "class_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"author_role" text NOT NULL,
	"body" text,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_chat_messages_role" CHECK ("class_chat_messages"."author_role" in ('maestro', 'alumno'))
);
--> statement-breakpoint
ALTER TABLE "virtual_classes" ADD COLUMN "chat_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "class_chat_messages" ADD CONSTRAINT "class_chat_messages_assignment_fk" FOREIGN KEY ("school_id","assignment_id") REFERENCES "public"."teaching_assignments"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_chat_messages_class_idx" ON "class_chat_messages" USING btree ("assignment_id","created_at");