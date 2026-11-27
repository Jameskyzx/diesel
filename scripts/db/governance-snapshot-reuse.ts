import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

import { z } from "zod";

// Verified row reuse for the raw-JSON governance tables.
//
// Over a slow server-to-database link the snapshot is bandwidth-bound, and
// almost all of its bytes are the JSON columns of these three tables, which
// grow with every release. A previous snapshot already holds most of those
// rows. The exporter therefore first reads only a SHA-256 digest per row,
// computed inside PostgreSQL over the exact projected text, and fetches in
// full only the rows whose digest does not match a row of the previous file.
// A reused row is byte-identical to what the full projection would have
// returned, so the written snapshot, its hash and the restore contract do
// not change. An unusable previous file only means that every row is fetched.

export type RawGovernanceProjectionColumn = {
  readonly expression: string;
  readonly kind: "integer" | "text";
  readonly name: string;
};

function utcTimestamp(column: string): string {
  return `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export const governanceDraftProjection = [
  { name: "id", expression: "id::text", kind: "text" },
  { name: "entityType", expression: "entity_type::text", kind: "text" },
  { name: "entityKey", expression: "entity_key", kind: "text" },
  { name: "version", expression: "version", kind: "integer" },
  { name: "workflowStatus", expression: "workflow_status::text", kind: "text" },
  { name: "payload", expression: "payload::text", kind: "text" },
  { name: "changeReason", expression: "change_reason", kind: "text" },
  { name: "createdBy", expression: "created_by", kind: "text" },
  { name: "reviewedBy", expression: "reviewed_by", kind: "text" },
  { name: "publishedBy", expression: "published_by", kind: "text" },
  { name: "reviewedAt", expression: utcTimestamp("reviewed_at"), kind: "text" },
  {
    name: "publishedAt",
    expression: utcTimestamp("published_at"),
    kind: "text",
  },
  { name: "archivedAt", expression: utcTimestamp("archived_at"), kind: "text" },
  { name: "createdAt", expression: utcTimestamp("created_at"), kind: "text" },
  { name: "updatedAt", expression: utcTimestamp("updated_at"), kind: "text" },
] as const satisfies readonly RawGovernanceProjectionColumn[];

export const marketImportBatchProjection = [
  { name: "id", expression: "id::text", kind: "text" },
  { name: "entityType", expression: "entity_type::text", kind: "text" },
  { name: "status", expression: "status::text", kind: "text" },
  { name: "originalFilename", expression: "original_filename", kind: "text" },
  { name: "contentSha256", expression: "content_sha256", kind: "text" },
  { name: "previewRows", expression: "preview_rows::text", kind: "text" },
  {
    name: "validationErrors",
    expression: "validation_errors::text",
    kind: "text",
  },
  { name: "totalRows", expression: "total_rows", kind: "integer" },
  { name: "validRows", expression: "valid_rows", kind: "integer" },
  { name: "invalidRows", expression: "invalid_rows", kind: "integer" },
  { name: "createdBy", expression: "created_by", kind: "text" },
  { name: "confirmedBy", expression: "confirmed_by", kind: "text" },
  {
    name: "committedAt",
    expression: utcTimestamp("committed_at"),
    kind: "text",
  },
  { name: "createdAt", expression: utcTimestamp("created_at"), kind: "text" },
] as const satisfies readonly RawGovernanceProjectionColumn[];

export const changeLogProjection = [
  { name: "id", expression: "id::text", kind: "text" },
  { name: "entityType", expression: "entity_type::text", kind: "text" },
  { name: "entityKey", expression: "entity_key", kind: "text" },
  { name: "action", expression: "action::text", kind: "text" },
  { name: "actorEmail", expression: "actor_email", kind: "text" },
  { name: "actorRole", expression: "actor_role::text", kind: "text" },
  { name: "draftId", expression: "draft_id::text", kind: "text" },
  { name: "importBatchId", expression: "import_batch_id::text", kind: "text" },
  { name: "beforeData", expression: "before_data::text", kind: "text" },
  { name: "afterData", expression: "after_data::text", kind: "text" },
  { name: "reason", expression: "reason", kind: "text" },
  { name: "createdAt", expression: utcTimestamp("created_at"), kind: "text" },
] as const satisfies readonly RawGovernanceProjectionColumn[];

export const reusableGovernanceTables = {
  data_change_logs: changeLogProjection,
  data_governance_drafts: governanceDraftProjection,
  market_import_batches: marketImportBatchProjection,
} as const;

export type ReusableGovernanceTableName = keyof typeof reusableGovernanceTables;

export type ProjectedGovernanceRow = Record<string, string | number | null> & {
  id: string;
};

export type ReusableGovernanceRows = Record<
  ReusableGovernanceTableName,
  ReadonlyMap<string, ProjectedGovernanceRow>
>;

// Digest batches carry about 110 bytes per row, so they can be much larger
// than the 100-row raw JSON batches without approaching the statement timeout.
export const governanceSnapshotDigestBatchSize = 2_000;
const governanceSnapshotMaximumReuseBytes = 256 * 1024 * 1024;

export function projectionSelectList(
  columns: readonly RawGovernanceProjectionColumn[],
): string {
  return columns
    .map((column) => `${column.expression} as "${column.name}"`)
    .join(",\n       ");
}

// Each value is encoded as `<utf8 byte length>:<text>` and NULL as `~`. A
// non-null value always starts with a digit, so the concatenation decodes in
// exactly one way and two different rows cannot share an encoding.
export function projectionDigestExpression(
  columns: readonly RawGovernanceProjectionColumn[],
): string {
  const encoded = columns.map((column) => {
    const text = `(${column.expression})::text`;
    return `coalesce(octet_length(${text})::text || ':' || ${text}, '~')`;
  });
  return `encode(sha256(convert_to(${encoded.join(" || ")}, 'UTF8')), 'hex')`;
}

export function digestProjectedRow(
  columns: readonly RawGovernanceProjectionColumn[],
  row: Readonly<Record<string, unknown>>,
): string | null {
  const keys = Object.keys(row);
  if (
    keys.length !== columns.length ||
    columns.some((column) => !Object.hasOwn(row, column.name))
  ) {
    return null;
  }

  let encoded = "";
  for (const column of columns) {
    const value = row[column.name];
    if (value === null) {
      encoded += "~";
      continue;
    }
    let text: string;
    if (column.kind === "integer") {
      if (typeof value !== "number" || !Number.isSafeInteger(value))
        return null;
      text = String(value);
    } else {
      if (typeof value !== "string") return null;
      text = value;
    }
    encoded += `${Buffer.byteLength(text, "utf8")}:${text}`;
  }
  return createHash("sha256").update(encoded, "utf8").digest("hex");
}

function emptyReusableRows(): ReusableGovernanceRows {
  return {
    data_change_logs: new Map(),
    data_governance_drafts: new Map(),
    market_import_batches: new Map(),
  };
}

const reuseFileSchema = z.object({
  tables: z.object({
    data_change_logs: z.array(z.unknown()).optional(),
    data_governance_drafts: z.array(z.unknown()).optional(),
    market_import_batches: z.array(z.unknown()).optional(),
  }),
});

// Rows are only candidates here: each is reused only after its digest matches
// the digest PostgreSQL computes for the live row in the exported snapshot.
export async function loadReusableGovernanceRows(
  path: string | null,
): Promise<ReusableGovernanceRows> {
  const reusable = emptyReusableRows();
  if (path === null) return reusable;

  try {
    const file = await lstat(path);
    if (!file.isFile() || file.size > governanceSnapshotMaximumReuseBytes) {
      return reusable;
    }
    const parsed = reuseFileSchema.safeParse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (!parsed.success) return reusable;

    for (const table of Object.keys(
      reusableGovernanceTables,
    ) as ReusableGovernanceTableName[]) {
      const rows = new Map<string, ProjectedGovernanceRow>();
      for (const row of parsed.data.tables[table] ?? []) {
        if (
          typeof row === "object" &&
          row !== null &&
          typeof (row as { id?: unknown }).id === "string"
        ) {
          rows.set((row as { id: string }).id, row as ProjectedGovernanceRow);
        }
      }
      reusable[table] = rows;
    }
    return reusable;
  } catch {
    return emptyReusableRows();
  }
}

const digestRowSchema = z
  .object({ id: z.uuid(), digest: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict();

export type ReusedGovernanceRows = {
  fetchedRows: number;
  reusedRows: number;
  rows: ProjectedGovernanceRow[];
};

export async function collectGovernanceRowsWithVerifiedReuse(options: {
  columns: readonly RawGovernanceProjectionColumn[];
  collectDigests: () => Promise<readonly unknown[]>;
  fetchRows: (ids: readonly string[]) => Promise<readonly unknown[]>;
  fetchBatchSize: number;
  reusable: ReadonlyMap<string, ProjectedGovernanceRow>;
}): Promise<ReusedGovernanceRows> {
  const { columns, fetchBatchSize, reusable } = options;
  if (!Number.isSafeInteger(fetchBatchSize) || fetchBatchSize <= 0) {
    throw new Error("Governance snapshot fetch batch size must be positive");
  }

  const digests = digestRowSchema.array().parse(await options.collectDigests());
  const slots: Array<ProjectedGovernanceRow | undefined> = [];
  const missing: Array<{ id: string; index: number }> = [];
  digests.forEach(({ id, digest }, index) => {
    const candidate = reusable.get(id);
    if (candidate && digestProjectedRow(columns, candidate) === digest) {
      slots.push(candidate);
    } else {
      slots.push(undefined);
      missing.push({ id, index });
    }
  });

  for (let start = 0; start < missing.length; start += fetchBatchSize) {
    const wanted = missing.slice(start, start + fetchBatchSize);
    const fetched = await options.fetchRows(wanted.map(({ id }) => id));
    const byId = new Map<string, ProjectedGovernanceRow>();
    for (const row of fetched) {
      if (
        typeof row !== "object" ||
        row === null ||
        digestProjectedRow(columns, row as Record<string, unknown>) === null
      ) {
        throw new Error("Governance snapshot fetched an invalid row");
      }
      const projected = row as ProjectedGovernanceRow;
      if (byId.has(projected.id)) {
        throw new Error("Governance snapshot fetched a duplicate row");
      }
      byId.set(projected.id, projected);
    }
    if (byId.size !== wanted.length) {
      throw new Error("Governance snapshot fetch did not match its digests");
    }
    for (const { id, index } of wanted) {
      const row = byId.get(id);
      if (!row) {
        throw new Error("Governance snapshot fetch did not match its digests");
      }
      slots[index] = row;
    }
  }

  return {
    fetchedRows: missing.length,
    reusedRows: digests.length - missing.length,
    rows: slots as ProjectedGovernanceRow[],
  };
}
