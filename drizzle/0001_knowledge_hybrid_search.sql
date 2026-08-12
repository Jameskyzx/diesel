CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."document_processing_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
DROP INDEX "document_chunks_document_hash_idx";--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "embedding" vector(128);--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "original_filename" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "byte_size" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_status" "document_processing_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_error" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "document_chunks_search_vector_idx" ON "document_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "documents_processing_status_idx" ON "documents" USING btree ("processing_status","updated_at");--> statement-breakpoint
CREATE INDEX "document_chunks_document_hash_idx" ON "document_chunks" USING btree ("document_id","content_hash");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_byte_size_check" CHECK ("documents"."byte_size" IS NULL OR "documents"."byte_size" >= 0);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_processing_error_check" CHECK ("documents"."processing_status" <> 'failed' OR "documents"."processing_error" IS NOT NULL);
