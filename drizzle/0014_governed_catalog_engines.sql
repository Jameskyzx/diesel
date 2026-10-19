ALTER TYPE "public"."governed_entity_type" ADD VALUE 'catalog_engine';--> statement-breakpoint
CREATE TABLE "catalog_engines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_code" text NOT NULL,
	"series" text NOT NULL,
	"category" text NOT NULL,
	"application_scopes" "application_scope"[] NOT NULL,
	"rated_power_kw" numeric(12, 3) NOT NULL,
	"rated_speed_rpm" numeric(12, 3) NOT NULL,
	"power_min_kw" numeric(12, 3) NOT NULL,
	"power_max_kw" numeric(12, 3) NOT NULL,
	"displacement_l" numeric(8, 3) NOT NULL,
	"cylinders" integer NOT NULL,
	"aftertreatment" text NOT NULL,
	"emission_label" text NOT NULL,
	"declared_citation_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"data_source_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "catalog_engines_category_check" CHECK ("catalog_engines"."category" IN ('truck', 'bus', 'construction', 'agriculture', 'generator-set', 'marine')),
	CONSTRAINT "catalog_engines_power_check" CHECK ("catalog_engines"."power_min_kw" >= 0 AND "catalog_engines"."power_max_kw" > "catalog_engines"."power_min_kw" AND "catalog_engines"."rated_power_kw" >= "catalog_engines"."power_min_kw" AND "catalog_engines"."rated_power_kw" < "catalog_engines"."power_max_kw" AND "catalog_engines"."rated_speed_rpm" > 0),
	CONSTRAINT "catalog_engines_geometry_check" CHECK ("catalog_engines"."displacement_l" > 0 AND "catalog_engines"."cylinders" > 0),
	CONSTRAINT "catalog_engines_application_scopes_check" CHECK (cardinality("catalog_engines"."application_scopes") > 0)
);
--> statement-breakpoint
ALTER TABLE "market_import_batches" ADD COLUMN "entity_type" "governed_entity_type" DEFAULT 'market_metric' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_engines" ADD CONSTRAINT "catalog_engines_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_engines_active_model_idx" ON "catalog_engines" USING btree ("model_code") WHERE "catalog_engines"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "catalog_engines_power_idx" ON "catalog_engines" USING btree ("power_min_kw","power_max_kw");--> statement-breakpoint
CREATE INDEX "catalog_engines_data_source_idx" ON "catalog_engines" USING btree ("data_source_id");