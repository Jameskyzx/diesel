import { z } from "zod";

import { findOverlappingMembershipIndexes } from "@/domain/admin/jurisdiction-membership";
import {
  applicationScopeSchema,
  dataCoverageStatusSchema,
  decimalNumberStringSchema,
  governanceWorkflowStatusSchema,
  httpUrlSchema,
  iso3Schema,
  isoDateSchema,
  marketMetricDecimalSchema,
  regulationLimitDecimalSchema,
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
const nonnegativeNumberInputSchema = numberInputSchema.pipe(
  z.number().finite().nonnegative(),
);
const positiveNumberInputSchema = numberInputSchema.pipe(
  z.number().finite().positive(),
);

export const adminRoles = ["editor", "reviewer", "admin"] as const;
export const adminRoleSchema = z.enum(adminRoles);

export const dataChangeActions = [
  "draft_created",
  "reviewed",
  "published",
  "archived",
  "import_previewed",
  "import_committed",
  "document_reprocessed",
  "source_verified",
] as const;
export const dataChangeActionSchema = z.enum(dataChangeActions);

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

export const ADMIN_PRINCIPAL_EMAIL_RESPONSE_HEADER =
  "x-diesel-admin-principal-email";
export const ADMIN_PRINCIPAL_ROLE_RESPONSE_HEADER =
  "x-diesel-admin-principal-role";
export const ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER =
  "x-diesel-admin-expected-principal-email";
export const ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER =
  "x-diesel-admin-expected-principal-role";

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
    limitValue: regulationLimitDecimalSchema,
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
    valueNumeric: marketMetricDecimalSchema,
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
        for (const index of findOverlappingMembershipIndexes(memberships)) {
          context.addIssue({
            code: "custom",
            message: "membership periods for a country must not overlap",
            path: [index, "validFrom"],
          });
        }
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

const dashboardEmailSchema = z.email().max(320);
const dashboardStringSchema = z.string().trim().min(1).max(1_000);
const dashboardVersionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const dashboardCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const dashboardWorkflowStatusSchema = z.enum(["draft", "reviewed"]);

const governanceDashboardPayloadSchemas = {
  country: countryDraftPayloadSchema,
  data_source: dataSourceDraftPayloadSchema,
  document: documentDraftPayloadSchema,
  jurisdiction: jurisdictionDraftPayloadSchema,
  market_metric: marketMetricDraftPayloadSchema,
  product: productDraftPayloadSchema,
  product_certification: productCertificationDraftPayloadSchema,
  regulation: regulationDraftPayloadSchema,
} as const satisfies Record<
  (typeof governedEntityTypes)[number],
  z.ZodType
>;

type GovernanceDashboardPayloadIssue = {
  message: string;
  path: PropertyKey[];
};

function governanceDashboardPayloadIssues(input: {
  entityKey: string;
  entityType: (typeof governedEntityTypes)[number];
  path: PropertyKey[];
  payload: Record<string, unknown>;
}): GovernanceDashboardPayloadIssue[] {
  const issues: GovernanceDashboardPayloadIssue[] = [];
  const reference = governedEntityReferenceSchema.safeParse({
    entityKey: input.entityKey,
    entityType: input.entityType,
  });
  if (
    !reference.success ||
    reference.data.entityKey !== input.entityKey
  ) {
    issues.push({
      message: "entityKey must be a canonical key for entityType",
      path: ["entityKey"],
    });
  }

  const payload = governanceDashboardPayloadSchemas[
    input.entityType
  ].safeParse(input.payload);
  if (!payload.success) {
    for (const issue of payload.error.issues) {
      issues.push({
        message: issue.message,
        path: [...input.path, ...issue.path],
      });
    }
    return issues;
  }

  const identityField =
    input.entityType === "country"
      ? "iso3"
      : input.entityType === "document"
        ? "documentId"
        : "id";
  const canonicalPayload = payload.data as Record<string, unknown>;
  if (canonicalPayload[identityField] !== input.entityKey) {
    issues.push({
      message: `${identityField} must match entityKey`,
      path: [...input.path, identityField],
    });
  }

  return issues;
}

const governanceDashboardCurrentDraftShape = {
  changeReason: dashboardStringSchema,
  createdBy: dashboardEmailSchema,
  entityKey: z.string().trim().min(1).max(300),
  entityType: governedEntityTypeSchema,
  id: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
  version: dashboardVersionSchema,
  workflowStatus: dashboardWorkflowStatusSchema,
} as const;

export const governanceDashboardCurrentDraftSchema = z
  .object(governanceDashboardCurrentDraftShape)
  .strict()
  .superRefine((draft, context) => {
    for (const issue of governanceDashboardPayloadIssues({
      entityKey: draft.entityKey,
      entityType: draft.entityType,
      path: ["payload"],
      payload: draft.payload,
    })) {
      context.addIssue({ code: "custom", ...issue });
    }
  });

export const governancePublishedBaselineSchema = z
  .object({
    payload: z.record(z.string(), z.unknown()),
    publishedAt: isoTimestampSchema.nullable(),
    publishedBy: dashboardEmailSchema.nullable(),
    version: dashboardVersionSchema,
  })
  .strict();

export const governanceReviewDependencySchema = z
  .object({
    isDemo: z.boolean().nullable(),
    kind: z.enum([
      "country",
      "jurisdiction",
      "product",
      "regulation",
      "source",
    ]),
    label: z.string().trim().min(1).max(300).nullable(),
    path: z.string().trim().min(1).max(1_000),
    state: z.enum(["active", "archived", "missing"]),
    url: httpUrlSchema.nullable(),
    value: z.string().trim().min(1).max(300),
    verifiedAt: isoTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((dependency, context) => {
    const reference =
      dependency.kind === "country"
        ? iso3Schema.safeParse(dependency.value)
        : z.uuid().safeParse(dependency.value);
    if (!reference.success || reference.data !== dependency.value) {
      context.addIssue({
        code: "custom",
        message: "value must be a canonical identifier for kind",
        path: ["value"],
      });
    }
  });

export const governanceDraftReviewContextSchema = z
  .object({
    baselineStatus: z.enum([
      "active",
      "archived",
      "first_revision",
      "missing",
    ]),
    blockingReasons: z.array(dashboardStringSchema).max(8),
    dependencies: z.array(governanceReviewDependencySchema).max(256),
    publishedBaseline: governancePublishedBaselineSchema.nullable(),
    publishReady: z.boolean(),
  })
  .strict();

export const governanceDashboardDraftSchema = z
  .object({
    ...governanceDashboardCurrentDraftShape,
    reviewContext: governanceDraftReviewContextSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    for (const issue of governanceDashboardPayloadIssues({
      entityKey: draft.entityKey,
      entityType: draft.entityType,
      path: ["payload"],
      payload: draft.payload,
    })) {
      context.addIssue({ code: "custom", ...issue });
    }

    const baseline = draft.reviewContext.publishedBaseline;
    if (baseline) {
      for (const issue of governanceDashboardPayloadIssues({
        entityKey: draft.entityKey,
        entityType: draft.entityType,
        path: ["reviewContext", "publishedBaseline", "payload"],
        payload: baseline.payload,
      })) {
        context.addIssue({ code: "custom", ...issue });
      }
    }
  });

export const governanceWorkflowCountsSchema = z
  .object({
    draft: dashboardCountSchema,
    published: dashboardCountSchema,
    reviewed: dashboardCountSchema,
  })
  .strict();

const governanceDashboardAuditLogSchema = z
  .object({
    action: dataChangeActionSchema,
    actorEmail: dashboardEmailSchema,
    actorRole: adminRoleSchema,
    createdAt: isoTimestampSchema,
    entityKey: z.string().trim().min(1).max(300),
    entityType: governedEntityTypeSchema,
    id: z.uuid(),
    reason: dashboardStringSchema,
  })
  .strict()
  .superRefine((log, context) => {
    const reference = governedEntityReferenceSchema.safeParse({
      entityKey: log.entityKey,
      entityType: log.entityType,
    });
    if (!reference.success || reference.data.entityKey !== log.entityKey) {
      context.addIssue({
        code: "custom",
        message: "entityKey must be a canonical key for entityType",
        path: ["entityKey"],
      });
    }
  });

export const adminDashboardResponseSchema = z
  .object({
    auditLogs: z.array(governanceDashboardAuditLogSchema).max(30),
    drafts: z.array(governanceDashboardDraftSchema).max(100),
    status: z.literal("ok"),
    workflowCounts: governanceWorkflowCountsSchema,
  })
  .strict()
  .superRefine((dashboard, context) => {
    const visibleCounts = { draft: 0, reviewed: 0 };
    for (const draft of dashboard.drafts) {
      visibleCounts[draft.workflowStatus] += 1;
    }
    for (const status of ["draft", "reviewed"] as const) {
      if (dashboard.workflowCounts[status] < visibleCounts[status]) {
        context.addIssue({
          code: "custom",
          message: `${status} count cannot be smaller than the visible queue`,
          path: ["workflowCounts", status],
        });
      }
    }
  });

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
