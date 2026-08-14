import { createHash } from "node:crypto";

import { z } from "zod";

import {
  getApprovedRealCertificationIds,
  getApprovedRealProductIds,
} from "../../src/server/config/public-product-publication";

export const INVALID_PRODUCT_EXPECTED_COUNT = 8;
export const INVALID_PRODUCT_MANIFEST_VERSION =
  "invalid-unpublished-products-v1";

const nullableText = z.string().nullable();
const sourceSchema = z
  .object({
    id: z.uuid(),
    isDemo: z.boolean(),
    sourceType: z.string(),
    title: z.string(),
    url: nullableText,
  })
  .strict();
const certificationSchema = z
  .object({
    applicationScope: z.string(),
    certificateNumber: nullableText,
    id: z.uuid(),
    isDemo: z.boolean(),
    powerMaxKw: nullableText,
    powerMinKw: nullableText,
    productId: z.uuid(),
    regulationId: z.uuid(),
    source: sourceSchema,
    status: z.string(),
    validFrom: nullableText,
    validTo: nullableText,
    verifiedAt: z.string(),
  })
  .strict();
const productSchema = z
  .object({
    certifications: z.array(certificationSchema),
    id: z.uuid(),
    isDemo: z.boolean(),
    modelCode: z.string(),
    powerMaxKw: z.string(),
    powerMinKw: z.string(),
    source: sourceSchema,
    specificationVersion: z.string(),
    verifiedAt: z.string(),
  })
  .strict();

export const invalidProductManifestSchema = z
  .object({
    expectedCount: z.literal(INVALID_PRODUCT_EXPECTED_COUNT),
    generatedAt: z.iso.datetime({ offset: true }),
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    products: z.array(productSchema).length(INVALID_PRODUCT_EXPECTED_COUNT),
    version: z.literal(INVALID_PRODUCT_MANIFEST_VERSION),
  })
  .strict();

export type InvalidProductManifest = z.infer<
  typeof invalidProductManifestSchema
>;

export type MaintenanceSqlParameter =
  | boolean
  | null
  | number
  | string
  | string[];

export type MaintenanceSqlClient = {
  query<TRow extends Record<string, unknown>>(
    text: string,
    parameters?: readonly MaintenanceSqlParameter[],
  ): Promise<{ rows: TRow[] }>;
};

type ProductRow = {
  id: string;
  isDemo: boolean;
  modelCode: string;
  powerMaxKw: string;
  powerMinKw: string;
  sourceId: string;
  sourceIsDemo: boolean;
  sourceTitle: string;
  sourceType: string;
  sourceUrl: string | null;
  specificationVersion: string;
  verifiedAt: string;
};

type CertificationRow = {
  applicationScope: string;
  certificateNumber: string | null;
  id: string;
  isDemo: boolean;
  powerMaxKw: string | null;
  powerMinKw: string | null;
  productId: string;
  regulationId: string;
  sourceId: string;
  sourceIsDemo: boolean;
  sourceTitle: string;
  sourceType: string;
  sourceUrl: string | null;
  status: string;
  validFrom: string | null;
  validTo: string | null;
  verifiedAt: string;
};

function canonicalProducts(
  products: InvalidProductManifest["products"],
): string {
  return JSON.stringify(products);
}

export function productManifestSha256(
  products: InvalidProductManifest["products"],
): string {
  return createHash("sha256").update(canonicalProducts(products)).digest("hex");
}

export function assertValidInvalidProductManifest(
  input: unknown,
): InvalidProductManifest {
  const manifest = invalidProductManifestSchema.parse(input);
  if (productManifestSha256(manifest.products) !== manifest.manifestSha256) {
    throw new Error("Invalid-product manifest SHA256 does not match its rows.");
  }
  const approvedProducts = new Set(getApprovedRealProductIds());
  const approvedCertifications = new Set(getApprovedRealCertificationIds());
  for (const product of manifest.products) {
    if (product.isDemo || product.source.isDemo) {
      throw new Error("Dirty-product maintenance refuses Demo products or sources.");
    }
    if (approvedProducts.has(product.id)) {
      throw new Error(`Product ${product.id} is present in the public approval manifest.`);
    }
    for (const certification of product.certifications) {
      if (approvedCertifications.has(certification.id)) {
        throw new Error(
          `Certification ${certification.id} is present in the public approval manifest.`,
        );
      }
    }
  }
  return manifest;
}

export async function readInvalidProductManifest(
  client: MaintenanceSqlClient,
  generatedAt = new Date(),
): Promise<InvalidProductManifest> {
  const productRows = (await client.query<ProductRow>(
    `select p.id::text as "id",
            p.model_code as "modelCode",
            p.power_min_kw::text as "powerMinKw",
            p.power_max_kw::text as "powerMaxKw",
            p.specification_version as "specificationVersion",
            p.verified_at::text as "verifiedAt",
            p.is_demo as "isDemo",
            s.id::text as "sourceId",
            s.title as "sourceTitle",
            s.source_type::text as "sourceType",
            s.url as "sourceUrl",
            s.is_demo as "sourceIsDemo"
       from products p
       join data_sources s on s.id = p.data_source_id
      where p.archived_at is null
        and p.is_demo = false
        and p.power_max_kw <= p.power_min_kw
      order by p.model_code, p.id`,
  )).rows;

  if (productRows.length !== INVALID_PRODUCT_EXPECTED_COUNT) {
    throw new Error(
      `Expected exactly ${INVALID_PRODUCT_EXPECTED_COUNT} active non-Demo invalid products, found ${productRows.length}.`,
    );
  }

  const productIds = productRows.map(({ id }) => id);
  const certificationRows = (await client.query<CertificationRow>(
    `select pc.id::text as "id",
            pc.product_id::text as "productId",
            pc.regulation_id::text as "regulationId",
            pc.application_scope::text as "applicationScope",
            pc.certificate_number as "certificateNumber",
            pc.status::text as "status",
            pc.power_min_kw::text as "powerMinKw",
            pc.power_max_kw::text as "powerMaxKw",
            pc.valid_from::text as "validFrom",
            pc.valid_to::text as "validTo",
            pc.verified_at::text as "verifiedAt",
            pc.is_demo as "isDemo",
            s.id::text as "sourceId",
            s.title as "sourceTitle",
            s.source_type::text as "sourceType",
            s.url as "sourceUrl",
            s.is_demo as "sourceIsDemo"
       from product_certifications pc
       join data_sources s on s.id = pc.data_source_id
      where pc.archived_at is null
        and pc.product_id = any($1::uuid[])
      order by pc.product_id, pc.id`,
    [productIds],
  )).rows;

  const products = productRows.map((row) => ({
    certifications: certificationRows
      .filter(({ productId }) => productId === row.id)
      .map((certification) => ({
        applicationScope: certification.applicationScope,
        certificateNumber: certification.certificateNumber,
        id: certification.id,
        isDemo: certification.isDemo,
        powerMaxKw: certification.powerMaxKw,
        powerMinKw: certification.powerMinKw,
        productId: certification.productId,
        regulationId: certification.regulationId,
        source: {
          id: certification.sourceId,
          isDemo: certification.sourceIsDemo,
          sourceType: certification.sourceType,
          title: certification.sourceTitle,
          url: certification.sourceUrl,
        },
        status: certification.status,
        validFrom: certification.validFrom,
        validTo: certification.validTo,
        verifiedAt: certification.verifiedAt,
      })),
    id: row.id,
    isDemo: row.isDemo,
    modelCode: row.modelCode,
    powerMaxKw: row.powerMaxKw,
    powerMinKw: row.powerMinKw,
    source: {
      id: row.sourceId,
      isDemo: row.sourceIsDemo,
      sourceType: row.sourceType,
      title: row.sourceTitle,
      url: row.sourceUrl,
    },
    specificationVersion: row.specificationVersion,
    verifiedAt: row.verifiedAt,
  }));
  const manifest = {
    expectedCount: INVALID_PRODUCT_EXPECTED_COUNT,
    generatedAt: generatedAt.toISOString(),
    manifestSha256: productManifestSha256(products),
    products,
    version: INVALID_PRODUCT_MANIFEST_VERSION,
  };
  return assertValidInvalidProductManifest(manifest);
}

function sameManifestRows(
  actual: InvalidProductManifest,
  expected: InvalidProductManifest,
): boolean {
  return actual.manifestSha256 === expected.manifestSha256 &&
    canonicalProducts(actual.products) === canonicalProducts(expected.products);
}

async function updateExactly(
  client: MaintenanceSqlClient,
  text: string,
  parameters: readonly MaintenanceSqlParameter[],
  expectedIds: readonly string[],
  entityLabel: string,
): Promise<void> {
  const rows = (await client.query<{ id: string }>(text, parameters)).rows;
  const actualIds = rows.map(({ id }) => id).sort();
  if (JSON.stringify(actualIds) !== JSON.stringify([...expectedIds].sort())) {
    throw new Error(`${entityLabel} archival row count or identity drifted.`);
  }
}

export async function applyInvalidProductManifest(input: {
  actorEmail: string;
  client: MaintenanceSqlClient;
  expectedManifest: unknown;
  now?: Date;
  reason: string;
}): Promise<{ archivedCertifications: number; archivedProducts: number }> {
  const expected = assertValidInvalidProductManifest(input.expectedManifest);
  const now = input.now ?? new Date();
  if (!input.actorEmail.trim() || !input.reason.trim()) {
    throw new Error("Apply requires a non-empty actor email and reason.");
  }

  await input.client.query("begin isolation level serializable");
  try {
    const actual = await readInvalidProductManifest(input.client, now);
    if (!sameManifestRows(actual, expected)) {
      throw new Error("Current dirty-product rows do not exactly match the dry-run manifest.");
    }

    const certifications = expected.products.flatMap(
      ({ certifications }) => certifications,
    );
    const certificationIds = certifications.map(({ id }) => id);
    if (certificationIds.length > 0) {
      await updateExactly(
        input.client,
        `update product_certifications
            set archived_at = $1::timestamptz, updated_at = $1::timestamptz
          where archived_at is null and id = any($2::uuid[])
        returning id::text as "id"`,
        [now.toISOString(), certificationIds],
        certificationIds,
        "Certification",
      );
    }
    for (const certification of certifications) {
      await input.client.query(
        `insert into data_change_logs
           (id, entity_type, entity_key, action, actor_email, actor_role,
            before_data, after_data, reason, created_at)
         values ($1::uuid, 'product_certification', $2, 'archived', $3, 'admin',
                 $4::jsonb, $5::jsonb, $6, $7::timestamptz)`,
        [
          crypto.randomUUID(),
          certification.id,
          input.actorEmail.trim(),
          JSON.stringify(certification),
          JSON.stringify({ archivedAt: now.toISOString() }),
          input.reason.trim(),
          now.toISOString(),
        ],
      );
    }

    const productIds = expected.products.map(({ id }) => id);
    await updateExactly(
      input.client,
      `update products
          set archived_at = $1::timestamptz, updated_at = $1::timestamptz
        where archived_at is null and id = any($2::uuid[])
      returning id::text as "id"`,
      [now.toISOString(), productIds],
      productIds,
      "Product",
    );
    for (const product of expected.products) {
      await input.client.query(
        `insert into data_change_logs
           (id, entity_type, entity_key, action, actor_email, actor_role,
            before_data, after_data, reason, created_at)
         values ($1::uuid, 'product', $2, 'archived', $3, 'admin',
                 $4::jsonb, $5::jsonb, $6, $7::timestamptz)`,
        [
          crypto.randomUUID(),
          product.id,
          input.actorEmail.trim(),
          JSON.stringify(product),
          JSON.stringify({ archivedAt: now.toISOString() }),
          input.reason.trim(),
          now.toISOString(),
        ],
      );
    }

    const remaining = (await input.client.query<{ count: number }>(
      `select count(*)::int as "count"
         from products
        where archived_at is null
          and is_demo = false
          and power_max_kw <= power_min_kw`,
    )).rows[0]?.count;
    if (remaining !== 0) {
      throw new Error("Active invalid products remain after archival.");
    }
    await input.client.query("commit");
    return {
      archivedCertifications: certificationIds.length,
      archivedProducts: productIds.length,
    };
  } catch (error) {
    await input.client.query("rollback");
    throw error;
  }
}
