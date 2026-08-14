ALTER TABLE "products" DROP CONSTRAINT "products_power_check";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_power_check" CHECK ("products"."archived_at" IS NOT NULL OR ("products"."power_min_kw" >= 0 AND "products"."power_max_kw" > "products"."power_min_kw"));
