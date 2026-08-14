import { normalizePostgresConstraintDefinition } from "./postgres-constraint-definition";

export type MigrationIdentity = {
  createdAt: string;
  hash: string;
};

export const recognizedLegacyMigrationExtras = [
  {
    createdAt: "1785737341036",
    hash: "1b31fb1475701ab7c0deab696ea15645efbb8680fcb59529d03961a693362227",
  },
] as const satisfies readonly MigrationIdentity[];

export const recognizedMigrationHashAliases = [
  {
    createdAt: "1786723485791",
    hash: "9f58f8762e70f3a76595de05efdca78c858b23c2fb54e2e4c1fe1acfc124ff3e",
  },
] as const satisfies readonly MigrationIdentity[];

export type ProductionReadback = {
  activeInvalidProducts: number;
  apiRateLimitTableExists: boolean;
  expectedMigrationCount: number;
  membershipExclusionDefinition: string;
  migrationCount: number;
  productPowerDefinition: string;
  rateLimitCountDefinition: string;
  recognizedLegacyMigrationCount: number;
};

function migrationKey(identity: MigrationIdentity): string {
  return `${identity.createdAt}:${identity.hash}`;
}

export function assertProductionMigrationLineage(input: {
  actual: readonly MigrationIdentity[];
  expected: readonly MigrationIdentity[];
}): {
  recognizedLegacyHashAliases: number;
  recognizedLegacyMigrationCount: number;
} {
  const actualByTimestamp = new Map<string, MigrationIdentity>();
  for (const migration of input.actual) {
    if (actualByTimestamp.has(migration.createdAt)) {
      throw new Error("Production migration journal contains duplicate timestamps.");
    }
    actualByTimestamp.set(migration.createdAt, migration);
  }

  const expectedTimestamps = new Set<string>();
  let recognizedLegacyHashAliases = 0;
  for (const expected of input.expected) {
    if (expectedTimestamps.has(expected.createdAt)) {
      throw new Error("Repository migration journal contains duplicate timestamps.");
    }
    expectedTimestamps.add(expected.createdAt);
    const actual = actualByTimestamp.get(expected.createdAt);
    if (!actual) {
      throw new Error("Production migration journal is missing a repository migration.");
    }
    if (actual.hash === expected.hash) {
      continue;
    }
    const recognizedAlias = recognizedMigrationHashAliases.some(
      (alias) => migrationKey(alias) === migrationKey(actual),
    );
    if (!recognizedAlias) {
      throw new Error("Production migration hash does not match the repository.");
    }
    recognizedLegacyHashAliases += 1;
  }

  let recognizedLegacyMigrationCount = 0;
  for (const actual of input.actual) {
    if (expectedTimestamps.has(actual.createdAt)) {
      continue;
    }
    const recognizedExtra = recognizedLegacyMigrationExtras.some(
      (legacy) => migrationKey(legacy) === migrationKey(actual),
    );
    if (!recognizedExtra) {
      throw new Error("Production migration journal contains an unknown extra migration.");
    }
    recognizedLegacyMigrationCount += 1;
  }

  return {
    recognizedLegacyHashAliases,
    recognizedLegacyMigrationCount,
  };
}

export function assertProductionReadback(input: ProductionReadback): void {
  if (
    input.recognizedLegacyMigrationCount < 0 ||
    input.recognizedLegacyMigrationCount > recognizedLegacyMigrationExtras.length ||
    input.migrationCount !==
      input.expectedMigrationCount + input.recognizedLegacyMigrationCount
  ) {
    throw new Error("Production migration journal does not match the repository.");
  }
  const productPower = normalizePostgresConstraintDefinition(
    input.productPowerDefinition,
  );
  if (
    !productPower.includes("archived_atisnotnull") ||
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
