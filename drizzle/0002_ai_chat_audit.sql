CREATE TYPE "public"."ai_tool_call_status" AS ENUM('success', 'no_data', 'error');--> statement-breakpoint
CREATE TYPE "public"."ai_tool_name" AS ENUM('searchKnowledgeBase', 'getCountryProfile', 'findCompatibleProducts');--> statement-breakpoint
CREATE TABLE "ai_chat_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"selected_country_iso3" varchar(3),
	"model_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_chat_sessions_country_iso3_check" CHECK ("ai_chat_sessions"."selected_country_iso3" IS NULL OR "ai_chat_sessions"."selected_country_iso3" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "ai_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_call_audit_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"document_id" uuid,
	"chunk_id" uuid,
	"regulation_id" uuid,
	"product_certification_id" uuid,
	"country_iso3" varchar(3),
	"title" text NOT NULL,
	"locator" text,
	"source_url" text,
	"page_from" integer,
	"page_to" integer,
	"section_locator" text,
	"regulation_status" "regulation_status",
	"published_on" date,
	"verified_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_citations_pages_check" CHECK (("ai_citations"."page_from" IS NULL OR "ai_citations"."page_from" > 0) AND ("ai_citations"."page_to" IS NULL OR ("ai_citations"."page_from" IS NOT NULL AND "ai_citations"."page_to" >= "ai_citations"."page_from")))
);
--> statement-breakpoint
CREATE TABLE "ai_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_name" "ai_tool_name" NOT NULL,
	"status" "ai_tool_call_status" NOT NULL,
	"input" jsonb NOT NULL,
	"result_summary" jsonb NOT NULL,
	"error_code" text,
	"duration_ms" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_tool_calls_duration_check" CHECK ("ai_tool_calls"."duration_ms" >= 0),
	CONSTRAINT "ai_tool_calls_time_check" CHECK ("ai_tool_calls"."completed_at" >= "ai_tool_calls"."started_at")
);
--> statement-breakpoint
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_tool_call_audit_id_ai_tool_calls_id_fk" FOREIGN KEY ("tool_call_audit_id") REFERENCES "public"."ai_tool_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_session_id_ai_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_regulation_id_regulations_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."regulations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_product_certification_id_product_certifications_id_fk" FOREIGN KEY ("product_certification_id") REFERENCES "public"."product_certifications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_country_iso3_countries_iso3_fk" FOREIGN KEY ("country_iso3") REFERENCES "public"."countries"("iso3") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_session_id_ai_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_chat_sessions_updated_idx" ON "ai_chat_sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "ai_citations_session_created_idx" ON "ai_citations" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_citations_source_idx" ON "ai_citations" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "ai_citations_document_chunk_idx" ON "ai_citations" USING btree ("document_id","chunk_id");--> statement-breakpoint
CREATE INDEX "ai_citations_regulation_idx" ON "ai_citations" USING btree ("regulation_id");--> statement-breakpoint
CREATE INDEX "ai_citations_certification_idx" ON "ai_citations" USING btree ("product_certification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tool_calls_session_call_idx" ON "ai_tool_calls" USING btree ("session_id","tool_call_id");--> statement-breakpoint
CREATE INDEX "ai_tool_calls_tool_status_created_idx" ON "ai_tool_calls" USING btree ("tool_name","status","created_at");