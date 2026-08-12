CREATE TYPE "public"."application_scope" AS ENUM('on-road', 'non-road', 'marine', 'generator-set', 'agriculture', 'construction');--> statement-breakpoint
CREATE TYPE "public"."certification_status" AS ENUM('pending', 'active', 'expired', 'withdrawn', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('regulation-text', 'government-notice', 'product-manual', 'industry-report', 'certificate', 'other');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_type" AS ENUM('country', 'regional', 'international');--> statement-breakpoint
CREATE TYPE "public"."regulation_status" AS ENUM('proposed', 'adopted', 'effective', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('official-regulation', 'government-notice', 'product-manual', 'industry-report', 'certificate', 'demo', 'other');--> statement-breakpoint
CREATE TABLE "countries" (
	"iso3" varchar(3) PRIMARY KEY NOT NULL,
	"iso2" varchar(2) NOT NULL,
	"name_en" text NOT NULL,
	"name_local" text,
	"region_code" text,
	"subregion_code" text,
	"data_coverage_status" text DEFAULT 'none' NOT NULL,
	"data_source_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "countries_iso2_unique" UNIQUE("iso2"),
	CONSTRAINT "countries_iso3_check" CHECK ("countries"."iso3" ~ '^[A-Z]{3}$'),
	CONSTRAINT "countries_iso2_check" CHECK ("countries"."iso2" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "country_jurisdictions" (
	"country_iso3" varchar(3) NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"data_source_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "country_jurisdictions_pk" PRIMARY KEY("country_iso3","jurisdiction_id"),
	CONSTRAINT "country_jurisdictions_validity_check" CHECK ("country_jurisdictions"."valid_to" IS NULL OR "country_jurisdictions"."valid_to" > "country_jurisdictions"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"publisher" text,
	"source_type" "source_type" NOT NULL,
	"url" text,
	"published_on" date,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"demo_notice" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_sources_demo_notice_check" CHECK (NOT "data_sources"."is_demo" OR "data_sources"."demo_notice" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"heading_path" text[],
	"page_from" integer,
	"page_to" integer,
	"section_locator" text,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"jurisdiction_id" uuid,
	"country_iso3" varchar(3),
	"application_scope" "application_scope",
	"valid_from" date,
	"valid_to" date,
	"token_count" integer,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_index_check" CHECK ("document_chunks"."chunk_index" >= 0),
	CONSTRAINT "document_chunks_pages_check" CHECK (("document_chunks"."page_from" IS NULL OR "document_chunks"."page_from" > 0) AND ("document_chunks"."page_to" IS NULL OR ("document_chunks"."page_from" IS NOT NULL AND "document_chunks"."page_to" >= "document_chunks"."page_from"))),
	CONSTRAINT "document_chunks_validity_check" CHECK ("document_chunks"."valid_to" IS NULL OR ("document_chunks"."valid_from" IS NOT NULL AND "document_chunks"."valid_to" > "document_chunks"."valid_from")),
	CONSTRAINT "document_chunks_hash_check" CHECK ("document_chunks"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "document_chunks_token_count_check" CHECK ("document_chunks"."token_count" IS NULL OR "document_chunks"."token_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"title" text NOT NULL,
	"canonical_url" text,
	"storage_path" text,
	"language_code" varchar(10) NOT NULL,
	"published_on" date,
	"valid_from" date,
	"valid_to" date,
	"content_sha256" varchar(64) NOT NULL,
	"license_code" text,
	"redistribution_allowed" boolean,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"demo_notice" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_content_sha256_unique" UNIQUE("content_sha256"),
	CONSTRAINT "documents_validity_check" CHECK ("documents"."valid_to" IS NULL OR ("documents"."valid_from" IS NOT NULL AND "documents"."valid_to" > "documents"."valid_from")),
	CONSTRAINT "documents_hash_check" CHECK ("documents"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "documents_demo_notice_check" CHECK (NOT "documents"."is_demo" OR "documents"."demo_notice" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "jurisdiction_type" NOT NULL,
	"country_iso3" varchar(3),
	"website_url" text,
	"data_source_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jurisdictions_code_unique" UNIQUE("code"),
	CONSTRAINT "jurisdictions_country_type_check" CHECK ("jurisdictions"."type" <> 'country' OR "jurisdictions"."country_iso3" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "market_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_iso3" varchar(3) NOT NULL,
	"metric_code" text NOT NULL,
	"metric_name" text NOT NULL,
	"definition" text NOT NULL,
	"application_scope" "application_scope",
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"value_numeric" numeric(24, 6) NOT NULL,
	"unit_code" text NOT NULL,
	"currency_code" varchar(3),
	"methodology_version" text NOT NULL,
	"published_on" date,
	"data_source_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_metrics_period_check" CHECK ("market_metrics"."period_end" > "market_metrics"."period_start"),
	CONSTRAINT "market_metrics_currency_check" CHECK ("market_metrics"."currency_code" IS NULL OR "market_metrics"."currency_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "product_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"regulation_id" uuid NOT NULL,
	"application_scope" "application_scope" NOT NULL,
	"certificate_number" text,
	"status" "certification_status" NOT NULL,
	"power_min_kw" numeric(12, 3),
	"power_max_kw" numeric(12, 3),
	"valid_from" date,
	"valid_to" date,
	"data_source_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_certifications_power_check" CHECK (("product_certifications"."power_min_kw" IS NULL OR "product_certifications"."power_min_kw" >= 0) AND ("product_certifications"."power_max_kw" IS NULL OR "product_certifications"."power_max_kw" > 0) AND ("product_certifications"."power_min_kw" IS NULL OR "product_certifications"."power_max_kw" IS NULL OR "product_certifications"."power_max_kw" > "product_certifications"."power_min_kw")),
	CONSTRAINT "product_certifications_validity_check" CHECK ("product_certifications"."valid_to" IS NULL OR ("product_certifications"."valid_from" IS NOT NULL AND "product_certifications"."valid_to" > "product_certifications"."valid_from"))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"application_scopes" "application_scope"[] NOT NULL,
	"power_min_kw" numeric(12, 3) NOT NULL,
	"power_max_kw" numeric(12, 3) NOT NULL,
	"specification_version" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"available_from" date,
	"available_to" date,
	"data_source_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_model_code_unique" UNIQUE("model_code"),
	CONSTRAINT "products_power_check" CHECK ("products"."power_min_kw" >= 0 AND "products"."power_max_kw" > "products"."power_min_kw"),
	CONSTRAINT "products_availability_check" CHECK ("products"."available_to" IS NULL OR ("products"."available_from" IS NOT NULL AND "products"."available_to" > "products"."available_from")),
	CONSTRAINT "products_application_scopes_check" CHECK (cardinality("products"."application_scopes") > 0)
);
--> statement-breakpoint
CREATE TABLE "regulation_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"regulation_id" uuid NOT NULL,
	"application_scope" "application_scope" NOT NULL,
	"engine_type_code" text DEFAULT 'CI' NOT NULL,
	"power_min_kw" numeric(12, 3),
	"power_max_kw" numeric(12, 3),
	"pollutant_code" text NOT NULL,
	"limit_value" numeric(18, 6) NOT NULL,
	"unit_code" text NOT NULL,
	"measurement_basis" text,
	"test_cycle_code" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"data_source_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regulation_limits_power_check" CHECK (("regulation_limits"."power_min_kw" IS NULL OR "regulation_limits"."power_min_kw" >= 0) AND ("regulation_limits"."power_max_kw" IS NULL OR "regulation_limits"."power_max_kw" > 0) AND ("regulation_limits"."power_min_kw" IS NULL OR "regulation_limits"."power_max_kw" IS NULL OR "regulation_limits"."power_max_kw" > "regulation_limits"."power_min_kw")),
	CONSTRAINT "regulation_limits_value_check" CHECK ("regulation_limits"."limit_value" >= 0),
	CONSTRAINT "regulation_limits_validity_check" CHECK ("regulation_limits"."valid_to" IS NULL OR "regulation_limits"."valid_to" > "regulation_limits"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "regulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"canonical_name" text NOT NULL,
	"citation_code" text,
	"status" "regulation_status" NOT NULL,
	"proposed_on" date,
	"adopted_on" date,
	"effective_from" date,
	"effective_to" date,
	"summary" text,
	"data_source_id" uuid NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regulations_effective_validity_check" CHECK ("regulations"."effective_to" IS NULL OR ("regulations"."effective_from" IS NOT NULL AND "regulations"."effective_to" > "regulations"."effective_from")),
	CONSTRAINT "regulations_effective_date_required_check" CHECK ("regulations"."status" <> 'effective' OR "regulations"."effective_from" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_jurisdictions" ADD CONSTRAINT "country_jurisdictions_country_iso3_countries_iso3_fk" FOREIGN KEY ("country_iso3") REFERENCES "public"."countries"("iso3") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_jurisdictions" ADD CONSTRAINT "country_jurisdictions_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "country_jurisdictions" ADD CONSTRAINT "country_jurisdictions_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_country_iso3_countries_iso3_fk" FOREIGN KEY ("country_iso3") REFERENCES "public"."countries"("iso3") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_country_iso3_countries_iso3_fk" FOREIGN KEY ("country_iso3") REFERENCES "public"."countries"("iso3") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_metrics" ADD CONSTRAINT "market_metrics_country_iso3_countries_iso3_fk" FOREIGN KEY ("country_iso3") REFERENCES "public"."countries"("iso3") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_metrics" ADD CONSTRAINT "market_metrics_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_certifications" ADD CONSTRAINT "product_certifications_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_certifications" ADD CONSTRAINT "product_certifications_regulation_id_regulations_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."regulations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_certifications" ADD CONSTRAINT "product_certifications_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulation_limits" ADD CONSTRAINT "regulation_limits_regulation_id_regulations_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."regulations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulation_limits" ADD CONSTRAINT "regulation_limits_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulations" ADD CONSTRAINT "regulations_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulations" ADD CONSTRAINT "regulations_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "countries_data_source_idx" ON "countries" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "countries_region_idx" ON "countries" USING btree ("region_code","subregion_code");--> statement-breakpoint
CREATE INDEX "country_jurisdictions_jurisdiction_idx" ON "country_jurisdictions" USING btree ("jurisdiction_id");--> statement-breakpoint
CREATE INDEX "country_jurisdictions_validity_idx" ON "country_jurisdictions" USING btree ("country_iso3","valid_from","valid_to");--> statement-breakpoint
CREATE INDEX "country_jurisdictions_source_idx" ON "country_jurisdictions" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "data_sources_type_verified_idx" ON "data_sources" USING btree ("source_type","verified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_document_index_idx" ON "document_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_document_hash_idx" ON "document_chunks" USING btree ("document_id","content_hash");--> statement-breakpoint
CREATE INDEX "document_chunks_country_scope_validity_idx" ON "document_chunks" USING btree ("country_iso3","application_scope","valid_from","valid_to");--> statement-breakpoint
CREATE INDEX "document_chunks_jurisdiction_idx" ON "document_chunks" USING btree ("jurisdiction_id");--> statement-breakpoint
CREATE INDEX "documents_data_source_idx" ON "documents" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "documents_type_validity_idx" ON "documents" USING btree ("type","valid_from","valid_to");--> statement-breakpoint
CREATE INDEX "jurisdictions_country_idx" ON "jurisdictions" USING btree ("country_iso3");--> statement-breakpoint
CREATE INDEX "jurisdictions_data_source_idx" ON "jurisdictions" USING btree ("data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_metrics_observation_idx" ON "market_metrics" USING btree ("country_iso3","metric_code","application_scope","period_start","period_end","data_source_id");--> statement-breakpoint
CREATE INDEX "market_metrics_country_period_idx" ON "market_metrics" USING btree ("country_iso3","metric_code","period_start","period_end");--> statement-breakpoint
CREATE INDEX "market_metrics_data_source_idx" ON "market_metrics" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "product_certifications_product_regulation_idx" ON "product_certifications" USING btree ("product_id","regulation_id");--> statement-breakpoint
CREATE INDEX "product_certifications_status_validity_idx" ON "product_certifications" USING btree ("status","valid_from","valid_to");--> statement-breakpoint
CREATE INDEX "product_certifications_data_source_idx" ON "product_certifications" USING btree ("data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_certifications_number_idx" ON "product_certifications" USING btree ("product_id","regulation_id","certificate_number");--> statement-breakpoint
CREATE INDEX "products_power_idx" ON "products" USING btree ("power_min_kw","power_max_kw");--> statement-breakpoint
CREATE INDEX "products_availability_idx" ON "products" USING btree ("available_from","available_to");--> statement-breakpoint
CREATE INDEX "products_data_source_idx" ON "products" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "regulation_limits_regulation_scope_validity_idx" ON "regulation_limits" USING btree ("regulation_id","application_scope","valid_from","valid_to");--> statement-breakpoint
CREATE INDEX "regulation_limits_power_idx" ON "regulation_limits" USING btree ("power_min_kw","power_max_kw");--> statement-breakpoint
CREATE INDEX "regulation_limits_data_source_idx" ON "regulation_limits" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "regulations_jurisdiction_status_validity_idx" ON "regulations" USING btree ("jurisdiction_id","status","effective_from","effective_to");--> statement-breakpoint
CREATE INDEX "regulations_data_source_idx" ON "regulations" USING btree ("data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "regulations_jurisdiction_citation_idx" ON "regulations" USING btree ("jurisdiction_id","citation_code");