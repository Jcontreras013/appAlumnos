CREATE TABLE "fee_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"due_on" date NOT NULL,
	"scope" text NOT NULL,
	"target_id" uuid,
	"scope_label" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_items_tenant_key" UNIQUE("school_id","id"),
	CONSTRAINT "fee_items_scope" CHECK ("fee_items"."scope" in ('centro', 'grado', 'seccion', 'alumno')),
	CONSTRAINT "fee_items_amount" CHECK ("fee_items"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_items" (
	"payment_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "payment_items_payment_id_charge_id_pk" PRIMARY KEY("payment_id","charge_id")
);
--> statement-breakpoint
CREATE TABLE "payment_settings" (
	"school_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'sandbox' NOT NULL,
	"endpoint" text NOT NULL,
	"key_id" text NOT NULL,
	"secret_encrypted" text,
	"updated_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"receipt_number" integer,
	"amount_cents" integer NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"status" text NOT NULL,
	"order_id" text,
	"gateway_uuid" text,
	"by_user_id" uuid NOT NULL,
	"by_name" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_order_unique" UNIQUE("order_id"),
	CONSTRAINT "payments_receipt_unique" UNIQUE("school_id","receipt_number"),
	CONSTRAINT "payments_status" CHECK ("payments"."status" in ('pendiente', 'confirmado', 'fallido', 'anulado')),
	CONSTRAINT "payments_method" CHECK ("payments"."method" in ('efectivo', 'deposito', 'transferencia', 'tarjeta'))
);
--> statement-breakpoint
CREATE TABLE "student_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"fee_item_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"payment_id" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_charges_unique" UNIQUE("fee_item_id","student_id"),
	CONSTRAINT "student_charges_status" CHECK ("student_charges"."status" in ('pendiente', 'pagado', 'anulado'))
);
--> statement-breakpoint
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_charge_id_student_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."student_charges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_charges" ADD CONSTRAINT "student_charges_fee_fk" FOREIGN KEY ("school_id","fee_item_id") REFERENCES "public"."fee_items"("school_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_items_school_idx" ON "fee_items" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_school_idx" ON "payments" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_student_idx" ON "payments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_charges_student_idx" ON "student_charges" USING btree ("student_id","status");