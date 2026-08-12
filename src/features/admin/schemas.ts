import { z } from "zod";

import {
  applicationScopeSchema,
  dataCoverageStatusSchema,
  decimalNumberStringSchema,
  governanceWorkflowStatusSchema,
  httpUrlSchema,
  iso3Schema,
  isoDateSchema,
} from "@/features/database/schemas";

const isoTimestampSchema = z.iso.datetime({ offset: true });
const maximumVerificationClockSkewMs = 5 * 60 * 1_000;
const verifiedTimestampSchema = isoTimestampSchema.refine(
  (value) =>
    new Date(value).getTime() <= Date.now() + maximumVerificationClockSkewMs,
  "verifiedAt must not be in the future",
);
const nullableTextSchema = z.string().trim().min(1).nullable().optional();
const entityIdSchema = z.uuid().optional();
const numberInputSchema = z
  .union([z.number(), decimalNumberStringSchema])
  .transform((value) =>
    typeof value === "number" ? value : Number(value),
  );
const finiteNumberInputSchema = numberInputSchema.pipe(z.number().finite());
const nonnegativeNumberInputSchema = numberInputSchema.pipe(
  z.number().finite().nonnegative(),
);
const positiveNumberInputSchema = numberInputSchema.pipe(
  z.number().finite().positive(),
);

export const adminRoles = ["editor", "reviewer", "admin"] as const;
export const adminRoleSchema = z.enum(adminRoles);

export const governedEntityTypes = [
  "country",
  "regulation",
  "product",
  "product_certification",
  "market_metric",
  "data_source",
  "document",
  "jurisdiction",
] as const;
export const governedEntityTypeSchema = z.enum(governedEntityTypes);

const uuidGovernedEntityTypeSchema = z.enum([
  "regulation",
  "product",
  "product_certification",
  "market_metric",
  "data_source",
  "document",
  "jurisdiction",
]);

export const governedEntityReferenceSchema = z.union([
  z
    .object({
      entityKey: iso3Schema,
      entityType: z.literal("country"),
    })
    .strict(),
  z
    .object({
      entityKey: z.uuid(),
      entityType: uuidGovernedEntityTypeSchema,
    })
    .strict(),
]);

export const adminPrincipalSchema = z
  .object({
    email: z.email(),
    role: adminRoleSchema,
  })
  .strict();

export const dataSourceDraftPayloadSchema = z
  .object({
    demoNotice: nullableTextSchema,
    id: entityIdSchema,
    isDemo: z.boolean().default(false),
    publishedOn: isoDateSchema.nullable().optional(),
    publisher: nullableTextSchema,
    sourceType: z.enum([
      "official-regulation",
      "government-notice",
      "product-manual",
      "industry-report",
      "certificate",
      "demo",
      "other",
    ]),
    title: z.string().trim().min(1).max(300),
    url: httpUrlSchema.nullable().optional(),
    verifiedAt: verifiedTimestampSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.isDemo !== (payload.sourceType === "demo")) {
      context.addIssue({
        code: "custom",
        message: "isDemo must be true if and only if sourceType is demo",
        path: ["sourceType"],
      });
    }
    if (payload.isDemo && !payload.demoNotice) {
      context.addIssue({
        code: "custom",
        message: "Demo sources require demoNotice",
        path: ["demoNotice"],
      });
    }
  });

export const countryDraftPayloadSchema = z
  .object({
    dataCoverageStatus: dataCoverageStatusSchema,
    dataSourceId: z.uuid(),
    isDemo: z.boolean().default(false),
    iso2: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    iso3: iso3Schema,
    nameEn: z.string().trim().min(1).max(200),
    nameLocal: nullableTextSchema,
    regionCode: nullableTextSchema,
    subregionCode: nullableTextSchema,
    verifiedAt: verifiedTimestampSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.isDemo !== (payload.dataCoverageStatus === "demo")) {
      context.addIssue({
        code: "custom",
        message: "isDemo must be true only for demo coverage",
        path: ["isDemo"],
      });
    }
  });

export const regulationLimitDraftPayloadSchema = z
  .object({
    applicationScope: applicationScopeSchema,
    dataSourceId: z.uuid(),
    engineTypeCode: z.string().trim().min(1).max(50).default("CI"),
    id: entityIdSchema,
    isDemo: z.boolean().default(false),
    limitValue: nonnegativeNumberInputSchema,
    measurementBasis: nullableTextSchema,
    pollutantCode: z.string().trim().min(1).max(50),
    powerMaxKw: positiveNumberInputSchema.nullable().optional(),
    powerMinKw: nonnegativeNumberInputSchema.nullable().optional(),
    testCycleCode: nullableTextSchema,
    unitCode: z.string().trim().min(1).max(80),
    validFrom: isoDateSchema,
    validTo: isoDateSchema.nullable().optional(),
    verifiedAt: verifiedTimestampSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.powerMinKw !== null &&
      payload.powerMinKw !== undefined &&
      payload.powerMaxKw !== null &&
      payload.powerMaxKw !== undefined &&
      payload.powerMaxKw <= payload.powerMinKw
    ) {
      context.addIssue({
        code: "custom",
        message: "powerMaxKw must be greater than powerMinKw",
        path: ["powerMaxKw"],
      });
    }
    if (
      payload.validTo &&
      payload.validTo <= payload.validFrom
    ) {
      context.addIssue({
        code: "custom",
        message: "validTo must be after validFrom",
        path: ["validTo"],
      });
    }
  });

export const regulationDraftPayloadSchema = z
  .object({
    adoptedOn: isoDateSchema.nullable().optional(),
    canonicalName: z.string().trim().min(1).max(300),
    citationCode: nullableTextSchema,
    dataSourceId: z.uuid(),
    effectiveFrom: isoDateSchema.nullable().optional(),
    effectiveTo: isoDateSchema.nullable().optional(),
    id: entityIdSchema,
    isDemo: z.boolean().default(false),
    jurisdictionId: z.uuid(),
    limits: z.array(regulationLimitDraftPayloadSchema).max(100),
    limitsUnavailable: z.boolean().default(false),
    proposedOn: isoDateSchema.nullable().optional(),
    status: z.enum(["proposed", "adopted", "effective", "superseded"]),
    summary: nullableTextSchema,
    verifiedAt: verifiedTimestampSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.limits.length === 0 && !payload.limitsUnavailable) {
      context.addIssue({
        code: "custom",
        message:
          "At least one limit is required unless limitsUnavailable is explicitly true",
        path: ["limits"],
      });
    }
    if (payload.limits.length > 0 && payload.limitsUnavailable) {
      context.addIssue({
        code: "custom",
        message:
          "limitsUnavailable must be false when numeric limits are provided",
        path: ["limitsUnavailable"],
      });
    }
    if (
      payload.limitsUnavailable &&
      (!payload.summary || payload.summary.trim().length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A summary explaining the unavailable limits is required",
        path: ["summary"],
      });
    }
    if (!payload.effectiveFrom) {
      if (payload.status === "effective") {
        context.addIssue({
          code: "custom",
          message: "Effective regulations require effectiveFrom",
          path: ["effectiveFrom"],
        });
      } else if (payload.effectiveTo) {
        context.addIssue({
          code: "custom",
          message: "effectiveFrom is required when effectiveTo is set",
          path: ["effectiveFrom"],
        });
      }
    }
    if (
      payload.effectiveFrom &&
      payload.effectiveTo &&
      payload.effectiveTo <= payload.effectiveFrom
    ) {
      context.addIssue({
        code: "custom",
        message: "effectiveTo must be after effectiveFrom",
        path: ["effectiveTo"],
      });
    }
  });

export const productDraftPayloadSchema = z
  .object({
    applicationScopes: z
      .array(applicationScopeSchema)
      .min(1)
      .superRefine((scopes, context) => {
        const seen = new Set<string>();
        scopes.forEach((scope, index) => {
          if (seen.has(scope)) {
            context.addIssue({
              code: "custom",
              message: "applicationScopes must not contain duplicates",
              path: [index],
            });
          }
          seen.add(scope);
        });
      }),
    availableFrom: isoDateSchema.nullable().optional(),
    availableTo: isoDateSchema.nullable().optional(),
    dataSourceId: z.uuid(),
    description: nullableTextSchema,
    id: entityIdSchema,
    isDemo: z.boolean().default(false),
    modelCode: z.string().trim().min(1).max(100).transform((value) => value.toUpperCase()),
    name: z.string().trim().min(1).max(300),
    parameters: z
      .record(
        z.string(),
        z.union([z.boolean(), z.number(), z.string(), z.null()]),
      )
      .default({}),
    powerMaxKw: positiveNumberInputSchema,
    powerMinKw: nonnegativeNumberInputSchema,
    specificationVersion: z.string().trim().min(1).max(100),
    verifiedAt: verifiedTimestampSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.powerMaxKw <= payload.powerMinKw) {
      context.addIssue({
        code: "custom",
        message: "powerMaxKw must be greater than powerMinKw",
        path: ["powerMaxKw"],
      });
    }
    if (payload.availableTo && !payload.availableFrom) {
      context.addIssue({
        code: "custom",
        message: "availableFrom is required when availableTo is set",
        path: ["availableFrom"],
      });
    }
    if (
      payload.availableFrom &&
      payload.availableTo &&
      payload.availableTo <= payload.availableFrom
    ) {
      context.addIssue({
        code: "custom",
        message: "availableTo must be after availableFrom",
        path: ["availableTo"],
      });
    }
  });

export const productCertificationDraftPayloadSchema = z
  .object({
    applicationScope: applicationScopeSchema,
    certificateNumber: nullableTextSchema,
    dataSourceId: z.uuid(),
    id: entityIdSchema,
    isDemo: z.boolean().default(false),
    powerMaxKw: positiveNumberInputSchema.nullable().optional(),
    powerMinKw: nonnegativeNumberInputSchema.nullable().optional(),
    productId: z.uuid(),
    regulationId: z.uuid(),
    status: z.enum([
      "pending",
      "active",
      "expired",
      "withdrawn",
      "unknown",
    ]),
    validFrom: isoDateSchema.nullable().optional(),
    validTo: isoDateSchema.nullable().optional(),
    verifiedAt: verifiedTimestampSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.powerMinKw !== null &&
      payload.powerMinKw !== undefined &&
      payload.powerMaxKw !== null &&
      payload.powerMaxKw !== undefined &&
      payload.powerMaxKw <= payload.powerMinKw
    ) {
      context.addIssue({
        code: "custom",
        message: "powerMaxKw must be greater than powerMinKw",
        path: ["powerMaxKw"],
      });
    }
    if (payload.validTo && !payload.validFrom) {
      context.addIssue({
        code: "custom",
        message: "validFrom is required when validTo is set",
        path: ["validFrom"],
      });
    }
    if (
      payload.validFrom &&
      payload.validTo &&
      payload.validTo <= payload.validFrom
    ) {
      context.addIssue({
        code: "custom",
        message: "validTo must be after validFrom",
        path: ["validTo"],
      });
    }
  });

const marketMetricDraftPayloadObjectSchema = z
  .object({
    applicationScope: applicationScopeSchema.nullable().optional(),
    countryIso3: iso3Schema,
    currencyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    dataSourceId: z.uuid(),
    definition: z.string().trim().min(1).max(2_000),
    id: entityIdSchema,
    isDemo: z.boolean().default(false),
    methodologyVersion: z.string().trim().min(1).max(100),
    metricCode: z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()),
    metricName: z.string().trim().min(1).max(300),
    periodEnd: isoDateSchema,
    periodStart: isoDateSchema,
    publishedOn: isoDateSchema.nullable().optional(),
    unitCode: z.string().trim().min(1).max(80),
    valueNumeric: finiteNumberInputSchema,
    verifiedAt: verifiedTimestampSchema,
  })
  .strict();

export const marketMetricDraftPayloadSchema =
  marketMetricDraftPayloadObjectSchema
  .superRefine((payload, context) => {
    if (payload.periodEnd <= payload.periodStart) {
      context.addIssue({
        code: "custom",
        message: "periodEnd must be after periodStart",
        path: ["periodEnd"],
      });
    }
  });

const jurisdictionMembershipDraftPayloadSchema = z
  .object({
    countryIso3: iso3Schema,
    dataSourceId: z.uuid(),
    isDemo: z.boolean().default(false),
    validFrom: isoDateSchema,
    validTo: isoDateSchema.nullable().optional(),
    verifiedAt: verifiedTimestampSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.validTo && payload.validTo <= payload.validFrom) {
      context.addIssue({
        code: "custom",
        message: "validTo must be after validFrom",
        path: ["validTo"],
      });
    }
  });

export const jurisdictionDraftPayloadSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    countryIso3: iso3Schema.nullable().optional(),
    dataSourceId: z.uuid(),
    id: entityIdSchema,
    isDemo: z.boolean().default(false),
    memberships: z
      .array(jurisdictionMembershipDraftPayloadSchema)
      .max(100)
      .superRefine((memberships, context) => {
        const seen = new Set<string>();
        memberships.forEach((membership, index) => {
          if (seen.has(membership.countryIso3)) {
            context.addIssue({
              code: "custom",
              message: "memberships must not repeat a country",
              path: [index, "countryIso3"],
            });
          }
          seen.add(membership.countryIso3);
        });
      }),
    name: z.string().trim().min(1).max(300),
    type: z.enum(["country", "regional", "international"]),
    verifiedAt: verifiedTimestampSchema,
    websiteUrl: httpUrlSchema.nullable().optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.type === "country") {
      if (!payload.countryIso3) {
        context.addIssue({
          code: "custom",
          message: "Country jurisdictions require countryIso3",
          path: ["countryIso3"],
        });
      }
      if (payload.memberships.length !== 1) {
        context.addIssue({
          code: "custom",
          message: "Country jurisdictions require exactly one membership",
          path: ["memberships"],
        });
      } else if (
        payload.countryIso3 &&
        payload.memberships[0]?.countryIso3 !== payload.countryIso3
      ) {
        context.addIssue({
          code: "custom",
          message: "Country jurisdiction membership must match countryIso3",
          path: ["memberships", 0, "countryIso3"],
        });
      }
    } else if (payload.countryIso3) {
      context.addIssue({
        code: "custom",
        message: "Only country jurisdictions may set countryIso3",
        path: ["countryIso3"],
      });
    }
  });

export const documentDraftPayloadSchema = z
  .object({
    documentId: z.uuid(),
  })
  .strict();

const draftRequestBase = {
  changeReason: z.string().trim().min(3).max(1_000),
};

export const governanceDraftCreateSchema = z.discriminatedUnion(
  "entityType",
  [
    z
      .object({
        ...draftRequestBase,
        entityType: z.literal("country"),
        payload: countryDraftPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...draftRequestBase,
        entityType: z.literal("regulation"),
        payload: regulationDraftPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...draftRequestBase,
        entityType: z.literal("product"),
        payload: productDraftPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...draftRequestBase,
        entityType: z.literal("product_certification"),
        payload: productCertificationDraftPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...draftRequestBase,
        entityType: z.literal("market_metric"),
        payload: marketMetricDraftPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...draftRequestBase,
        entityType: z.literal("data_source"),
        payload: dataSourceDraftPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...draftRequestBase,
        entityType: z.literal("document"),
        payload: documentDraftPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...draftRequestBase,
        entityType: z.literal("jurisdiction"),
        payload: jurisdictionDraftPayloadSchema,
      })
      .strict(),
  ],
);

export const governanceActionInputSchema = z
  .object({
    reason: z.string().trim().min(3).max(1_000),
  })
  .strict();

export const sourceVerificationInputSchema = governanceActionInputSchema
  .extend({
    verifiedAt: verifiedTimestampSchema,
  })
  .strict();

export const marketCsvPreviewInputSchema = z
  .object({
    content: z.string().min(1).max(2_000_000),
    fileName: z.string().trim().min(1).max(255),
  })
  .strict();

export const marketCsvRowSchema = marketMetricDraftPayloadObjectSchema.omit({
  id: true,
}).superRefine((payload, context) => {
  if (payload.periodEnd <= payload.periodStart) {
    context.addIssue({
      code: "custom",
      message: "periodEnd must be after periodStart",
      path: ["periodEnd"],
    });
  }
});

export const governanceDraftSummarySchema = z
  .object({
    archivedAt: isoTimestampSchema.nullable(),
    changeReason: z.string(),
    createdAt: isoTimestampSchema,
    createdBy: z.string(),
    entityKey: z.string(),
    entityType: governedEntityTypeSchema,
    id: z.uuid(),
    payload: z.record(z.string(), z.unknown()),
    publishedAt: isoTimestampSchema.nullable(),
    publishedBy: z.string().nullable(),
    reviewedAt: isoTimestampSchema.nullable(),
    reviewedBy: z.string().nullable(),
    updatedAt: isoTimestampSchema,
    version: z.number().int().positive(),
    workflowStatus: governanceWorkflowStatusSchema,
  })
  .strict();

export const adminDashboardResponseSchema = z
  .object({
    auditLogs: z.array(
      z
        .object({
          action: z.string(),
          actorEmail: z.string(),
          actorRole: adminRoleSchema,
          createdAt: isoTimestampSchema,
          entityKey: z.string(),
          entityType: governedEntityTypeSchema,
          id: z.uuid(),
          reason: z.string(),
        })
        .passthrough(),
    ),
    drafts: z.array(governanceDraftSummarySchema),
    importBatches: z.array(
      z
        .object({
          createdAt: isoTimestampSchema,
          id: z.uuid(),
          invalidRows: z.number().int().nonnegative(),
          originalFilename: z.string(),
          status: z.enum(["previewed", "committed", "rejected"]),
          totalRows: z.number().int().nonnegative(),
          validRows: z.number().int().nonnegative(),
        })
        .passthrough(),
    ),
    principal: adminPrincipalSchema,
    status: z.literal("ok"),
  })
  .strict();

export type AdminPrincipal = z.infer<typeof adminPrincipalSchema>;
export type AdminDashboardResponse = z.infer<
  typeof adminDashboardResponseSchema
>;
export type AdminRole = z.infer<typeof adminRoleSchema>;
export type GovernedEntityType = z.infer<typeof governedEntityTypeSchema>;
export type GovernanceDraftCreate = z.infer<
  typeof governanceDraftCreateSchema
>;
export type GovernanceWorkflowStatus = z.infer<
  typeof governanceWorkflowStatusSchema
>;
export type MarketCsvRow = z.infer<typeof marketCsvRowSchema>;
