import { normalizePostgresConstraintDefinition } from "./postgres-constraint-definition";

export type ProductionReadback = {
  activeInvalidProducts: number;
  apiRateLimitTableExists: boolean;
  expectedMigrationCount: number;
  membershipExclusionDefinition: string;
  migrationCount: number;
  productPowerDefinition: string;
  rateLimitCountDefinition: string;
};

export function assertProductionReadback(input: ProductionReadback): void {
  if (input.migrationCount !== input.expectedMigrationCount) {
    throw new Error("Production migration journal does not match the repository.");
  }
  const productPower = normalizePostgresConstraintDefinition(
    input.productPowerDefinition,
  );
  if (
    !productPower.includes("power_min_kw>=0") ||
    !productPower.includes("power_max_kw>power_min_kw") ||
    productPower.includes("power_max_kw>=power_min_kw")
  ) {
    throw new Error("Production products_power_check is not strict.");
  }
  const membership = normalizePostgresConstraintDefinition(
    input.membershipExclusionDefinition,
  );
  if (
    !membership.includes("excludeusinggist") ||
    !membership.includes("country_iso3with=") ||
    !membership.includes("jurisdiction_idwith=") ||
    !membership.includes("daterangevalid_from,valid_to,'['::textwith&&") ||
    !membership.includes("wherearchived_atisnull")
  ) {
    throw new Error("Production temporal membership exclusion is missing.");
  }
  if (!input.apiRateLimitTableExists) {
    throw new Error("Production shared API rate-limit table is missing.");
  }
  const rateLimitCount = normalizePostgresConstraintDefinition(
    input.rateLimitCountDefinition,
  );
  if (!rateLimitCount.includes("request_count>0")) {
    throw new Error("Production shared rate-limit count check is missing.");
  }
  if (input.activeInvalidProducts !== 0) {
    throw new Error("Production still contains active invalid products.");
  }
}
