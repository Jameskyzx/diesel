import { describe, expect, it } from "vitest";

import { normalizePostgresConstraintDefinition } from "../scripts/db/postgres-constraint-definition";

describe("normalizePostgresConstraintDefinition", () => {
  it.each([
    [
      "EXCLUDE USING gist (country_iso3 WITH =, jurisdiction_id WITH =, daterange(valid_from, valid_to, '[)'::text) WITH &&) WHERE ((archived_at IS NULL))",
      "excludeusinggistcountry_iso3with=,jurisdiction_idwith=,daterangevalid_from,valid_to,'['::textwith&&wherearchived_atisnull",
    ],
    [
      'EXCLUDE USING gist ("country_iso3" WITH =, "jurisdiction_id" WITH =, daterange("valid_from", "valid_to", \'[)\'::text) WITH &&) WHERE ("archived_at" IS NULL)',
      "excludeusinggistcountry_iso3with=,jurisdiction_idwith=,daterangevalid_from,valid_to,'['::textwith&&wherearchived_atisnull",
    ],
  ])("normalizes exclusion constraints with redundant parentheses", (input, expected) => {
    expect(normalizePostgresConstraintDefinition(input)).toBe(expected);
  });

  it("normalizes quoted product checks without changing comparison operators", () => {
    expect(
      normalizePostgresConstraintDefinition(
        'CHECK ((("power_min_kw" >= (0)::numeric) AND ("power_max_kw" > "power_min_kw")))',
      ),
    ).toBe(
      "checkpower_min_kw>=0::numericandpower_max_kw>power_min_kw",
    );
  });
});
