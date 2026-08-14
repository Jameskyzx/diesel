DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "products"
		WHERE "archived_at" IS NULL
			AND (
				"power_min_kw" < 0
				OR "power_max_kw" <= "power_min_kw"
			)
	) THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'products_power_check migration blocked: archive or resolve active products with power_max_kw <= power_min_kw before retrying';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_power_check";
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_power_check" CHECK ("products"."archived_at" IS NOT NULL OR ("products"."power_min_kw" >= 0 AND "products"."power_max_kw" > "products"."power_min_kw"));
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "country_jurisdictions" left_period
		JOIN "country_jurisdictions" right_period
			ON left_period."country_iso3" = right_period."country_iso3"
			AND left_period."jurisdiction_id" = right_period."jurisdiction_id"
			AND left_period.ctid < right_period.ctid
			AND daterange(left_period."valid_from", left_period."valid_to", '[)')
				&& daterange(right_period."valid_from", right_period."valid_to", '[)')
		WHERE left_period."archived_at" IS NULL
			AND right_period."archived_at" IS NULL
	) THEN
		RAISE EXCEPTION USING
			ERRCODE = '23P01',
			MESSAGE = 'country_jurisdictions migration blocked: resolve overlapping active membership periods before retrying';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "country_jurisdictions" DROP CONSTRAINT "country_jurisdictions_pk";
--> statement-breakpoint
ALTER TABLE "country_jurisdictions" ADD CONSTRAINT "country_jurisdictions_pk" PRIMARY KEY("country_iso3","jurisdiction_id","valid_from");
--> statement-breakpoint
DO $$
BEGIN
	IF position('(PGlite ' in version()) > 0 THEN
		RAISE NOTICE 'PGlite does not provide btree_gist; repository overlap validation remains active in tests';
	ELSE
		CREATE EXTENSION IF NOT EXISTS btree_gist;
		ALTER TABLE "country_jurisdictions"
			ADD CONSTRAINT "country_jurisdictions_no_active_overlap"
			EXCLUDE USING gist (
				"country_iso3" WITH =,
				"jurisdiction_id" WITH =,
				daterange("valid_from", "valid_to", '[)') WITH &&
			)
			WHERE ("archived_at" IS NULL);
	END IF;
END $$;
