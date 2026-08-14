CREATE TABLE "api_rate_limit_buckets" (
	"scope" varchar(80) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_rate_limit_buckets_pk" PRIMARY KEY("scope","key_hash","window_start"),
	CONSTRAINT "api_rate_limit_buckets_key_hash_check" CHECK ("api_rate_limit_buckets"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_rate_limit_buckets_count_check" CHECK ("api_rate_limit_buckets"."request_count" > 0),
	CONSTRAINT "api_rate_limit_buckets_expiry_check" CHECK ("api_rate_limit_buckets"."expires_at" > "api_rate_limit_buckets"."window_start")
);
--> statement-breakpoint
CREATE INDEX "api_rate_limit_buckets_expiry_idx" ON "api_rate_limit_buckets" USING btree ("expires_at");