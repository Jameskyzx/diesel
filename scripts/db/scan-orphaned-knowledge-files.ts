import { pathToFileURL } from "node:url";

import { getDatabase } from "../../src/server/db/client";
import { assertGovernanceMaintenanceAuthorized } from "../../src/server/db/governance-maintenance-lock";
import { removeDocumentFile } from "../../src/server/knowledge/local-document-storage";
import { findKnowledgeStorageOrphans } from "../../src/server/services/knowledge-service";
import { parseKnowledgeOrphanOptions } from "./knowledge-orphan-options";

async function main(): Promise<void> {
  const options = parseKnowledgeOrphanOptions(process.argv.slice(2));
  if (options.deleteFiles) {
    await getDatabase().transaction(async (transaction) => {
      await assertGovernanceMaintenanceAuthorized(transaction);
    });
  }

  const paths = await findKnowledgeStorageOrphans({
    minimumAgeMs: options.minimumAgeHours * 60 * 60 * 1000,
  });
  if (options.deleteFiles) {
    for (const storagePath of paths) {
      await removeDocumentFile(storagePath);
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      deleted: options.deleteFiles ? paths.length : 0,
      minimumAgeHours: options.minimumAgeHours,
      mode: options.deleteFiles ? "delete" : "dry-run",
      paths,
    })}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(
      "Knowledge orphan scan failed; no storage path or database credential was logged.\n",
    );
    process.exitCode = 1;
  });
}
