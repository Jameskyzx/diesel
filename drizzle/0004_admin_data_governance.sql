CREATE TYPE "public"."admin_role" AS ENUM('editor', 'reviewer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."data_change_action" AS ENUM('draft_created', 'reviewed', 'published', 'archived', 'import_previewed', 'import_committed', 'document_reprocessed', 'source_verified');--> statement-breakpoint
CREATE TYPE "public"."governance_workflow_status" AS ENUM('draft', 'reviewed', 'published');--> statement-breakpoint
CREATE TYPE "public"."governed_entity_type" AS ENUM('country', 'regulation', 'product', 'product_certification', 'market_metric', 'data_source', 'document');--> statement-breakpoint
CREATE TYPE "public"."market_import_status" AS ENUM('previewed', 'committed', 'rejected');--> statement-breakpoint
CREATE TABLE "data_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "governed_entity_type" NOT NULL,
	"entity_key" text NOT NULL,
	"action" "data_change_action" NOT NULL,
	"actor_email" text NOT NULL,
	"actor_role" "admin_role" NOT NULL,
	"draft_id" uuid,
	"import_batch_id" uuid,
	"before_data" jsonb,
	"after_data" jsonb,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_governance_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "governed_entity_type" NOT NULL,
	"entity_key" text NOT NULL,
	"version" integer NOT NULL,
	"workflow_status" "governance_workflow_status" DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"change_reason" text NOT NULL,
	"created_by" text NOT NULL,
	"reviewed_by" text,
	"published_by" text,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_governance_drafts_version_check" CHECK ("data_governance_drafts"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "market_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "market_import_status" DEFAULT 'previewed' NOT NULL,
	"original_filename" text NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"preview_rows" jsonb NOT NULL,
	"validation_errors" jsonb NOT NULL,
	"total_rows" integer NOT NULL,
	"valid_rows" integer NOT NULL,
	"invalid_rows" integer NOT NULL,
	"created_by" text NOT NULL,
	"confirmed_by" text,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_import_batches_counts_check" CHECK ("market_import_batches"."total_rows" >= 0 AND "market_import_batches"."valid_rows" >= 0 AND "market_import_batches"."invalid_rows" >= 0 AND "market_import_batches"."total_rows" = "market_import_batches"."valid_rows" + "market_import_batches"."invalid_rows"),
	CONSTRAINT "market_import_batches_hash_check" CHECK ("market_import_batches"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "country_jurisdictions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "governance_status" "governance_workflow_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "governance_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
UPDATE "documents"
SET
  "governance_status" = 'published',
  "governance_published_at" = COALESCE("processed_at", "created_at")
WHERE "archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_metrics" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_certifications" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "regulation_limits" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "regulations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_change_logs" ADD CONSTRAINT "data_change_logs_draft_id_data_governance_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."data_governance_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_logs" ADD CONSTRAINT "data_change_logs_import_batch_id_market_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."market_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_change_logs_entity_created_idx" ON "data_change_logs" USING btree ("entity_type","entity_key","created_at");--> statement-breakpoint
CREATE INDEX "data_change_logs_actor_created_idx" ON "data_change_logs" USING btree ("actor_email","created_at");--> statement-breakpoint
CREATE INDEX "data_change_logs_draft_idx" ON "data_change_logs" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "data_change_logs_batch_idx" ON "data_change_logs" USING btree ("import_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_governance_drafts_entity_version_idx" ON "data_governance_drafts" USING btree ("entity_type","entity_key","version");--> statement-breakpoint
CREATE INDEX "data_governance_drafts_workflow_idx" ON "data_governance_drafts" USING btree ("workflow_status","entity_type","updated_at");--> statement-breakpoint
CREATE INDEX "market_import_batches_status_created_idx" ON "market_import_batches" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "documents_governance_status_idx" ON "documents" USING btree ("governance_status","archived_at","updated_at");
