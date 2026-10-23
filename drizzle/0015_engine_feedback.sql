ALTER TYPE "public"."governed_entity_type" ADD VALUE 'engine_feedback';--> statement-breakpoint
CREATE TABLE "engine_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_engine_id" uuid NOT NULL,
	"model_code" text NOT NULL,
	"country_iso3" varchar(3),
	"occurred_on" date,
	"received_on" date NOT NULL,
	"category" text NOT NULL,
	"system" text NOT NULL,
	"component" text,
	"symptom" text NOT NULL,
	"customer_request" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"requested_power_value" numeric(12, 3),
	"requested_power_unit" text,
	"requested_power_kw" numeric(12, 3),
	"quantity_affected" integer,
	"severity" text NOT NULL,
	"evidence_quote" text NOT NULL,
	"evidence_verified" boolean NOT NULL,
	"source_kind" text NOT NULL,
	"source_language" text,
	"source_batch_id" uuid,
	"customer_ref" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "engine_feedback_category_check" CHECK ("engine_feedback"."category" IN ('failure', 'quality', 'performance_request', 'service_parts', 'commercial', 'documentation', 'other')),
	CONSTRAINT "engine_feedback_system_check" CHECK ("engine_feedback"."system" IN ('intake', 'exhaust', 'aftertreatment', 'fuel', 'cooling', 'lubrication', 'electronics', 'power_output', 'structure', 'other')),
	CONSTRAINT "engine_feedback_severity_check" CHECK ("engine_feedback"."severity" IN ('low', 'medium', 'high', 'safety')),
	CONSTRAINT "engine_feedback_source_kind_check" CHECK ("engine_feedback"."source_kind" IN ('chat_screenshot', 'paper_photo', 'pdf', 'email', 'text')),
	CONSTRAINT "engine_feedback_power_check" CHECK (("engine_feedback"."requested_power_value" IS NULL AND "engine_feedback"."requested_power_unit" IS NULL AND "engine_feedback"."requested_power_kw" IS NULL) OR ("engine_feedback"."requested_power_value" > 0 AND "engine_feedback"."requested_power_unit" IN ('kW', 'hp', 'PS') AND "engine_feedback"."requested_power_kw" > 0)),
	CONSTRAINT "engine_feedback_quantity_check" CHECK ("engine_feedback"."quantity_affected" IS NULL OR "engine_feedback"."quantity_affected" > 0)
);
--> statement-breakpoint
CREATE TABLE "feedback_source_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"media_type" text NOT NULL,
	"original_filename" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_path" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_source_files_size_check" CHECK ("feedback_source_files"."byte_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "engine_feedback" ADD CONSTRAINT "engine_feedback_catalog_engine_id_catalog_engines_id_fk" FOREIGN KEY ("catalog_engine_id") REFERENCES "public"."catalog_engines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_feedback" ADD CONSTRAINT "engine_feedback_country_iso3_countries_iso3_fk" FOREIGN KEY ("country_iso3") REFERENCES "public"."countries"("iso3") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_feedback" ADD CONSTRAINT "engine_feedback_source_batch_id_market_import_batches_id_fk" FOREIGN KEY ("source_batch_id") REFERENCES "public"."market_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "engine_feedback_engine_idx" ON "engine_feedback" USING btree ("catalog_engine_id");--> statement-breakpoint
CREATE INDEX "engine_feedback_country_idx" ON "engine_feedback" USING btree ("country_iso3");--> statement-breakpoint
CREATE INDEX "feedback_source_files_batch_idx" ON "feedback_source_files" USING btree ("batch_id");