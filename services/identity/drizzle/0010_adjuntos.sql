CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_attachments_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "message_attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "message_attachments_kind" CHECK ("message_attachments"."kind" in ('foto', 'video', 'archivo')),
	CONSTRAINT "message_attachments_size" CHECK ("message_attachments"."size_bytes" > 0),
	CONSTRAINT "message_attachments_name" CHECK (char_length("message_attachments"."file_name") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_body_length";--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_attachments_conversation_idx" ON "message_attachments" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_length" CHECK (char_length("messages"."body") <= 2000);--> statement-breakpoint
-- Como los mensajes, los adjuntos son registro: no se editan ni se borran.
CREATE OR REPLACE FUNCTION message_attachments_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'message_attachments es de solo inserción (operación % no permitida)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER message_attachments_no_update_delete
  BEFORE UPDATE OR DELETE ON message_attachments
  FOR EACH ROW EXECUTE FUNCTION message_attachments_append_only();
