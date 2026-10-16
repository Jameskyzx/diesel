import { catalogSnapshotSchema } from "@/features/product-catalog/schemas";

/** Input has already been extracted from XLSX. Preserve source values; do not
 * turn marketing declarations into independently verified specifications. */
export function importWeichaiCatalog(sheets: Record<string, unknown[][]>, sha256: string, importedOn: string) {
  const families = sheets["发动机产品清单"];
  const details = sheets["型谱表明细"];
  if (!families || !details || details[0]?.[4] !== "型号" || families[0]?.[3] !== "产品名称")
    throw new Error("Unexpected workbook layout");
  const text = (value: unknown) => value == null ? "" : String(value).trim();
  const excludedHeaderRows: number[] = [];
  const records = details.slice(1).flatMap((row, index) => {
    if (text(row[4]) === "型号") { excludedHeaderRows.push(index + 2); return []; }
    if (!text(row[4])) throw new Error(`Missing model at row ${index + 2}`);
    const familyIndex = families.findIndex((f, i) => i > 0 && text(f[18]) === text(row[20]) && text(f[3]) === text(row[3]));
    const family = families[familyIndex] ?? [];
    // Only parse a scalar with explicit kW/r/min headers. A hyphen is NOT a slash.
    const rated = /kW\/(?:r\/min|rpm)/iu.test(text(row[19]))
      ? /^(\d+(?:\.\d+)?)\s*(?:kW)?\s*\/\s*(\d+(?:\.\d+)?)\s*(?:r\/min)?$/iu.exec(text(row[5])) : null;
    return [{ id: `weichai-row-${index + 2}`, model: text(row[4]), category: text(row[1]), application: text(row[2]),
      product: text(row[3]), familyFuel: familyIndex < 0 ? "" : text(families[familyIndex]?.[10]),
      family: { series: text(family[4]), adaptation: text(family[5]), powerRange: text(family[6]), torqueRange: text(family[7]),
        displacement: text(family[8]), emissionClaim: text(family[9]), type: text(family[11]), cylinders: text(family[12]),
        valves: text(family[13]), aspiration: text(family[14]), dimensions: text(family[15]), weight: text(family[16]) },
      ratedPowerKw: rated ? Number(rated[1]) : null, ratedSpeedRpm: rated ? Number(rated[2]) : null,
      raw: { power: text(row[5]), torque: text(row[6]), speed: text(row[7]), idle: text(row[8]), displacement: text(row[9]),
        emissionClaim: text(row[10]), technicalRoute: text(row[11]), vehicle: text(row[12]), valves: text(row[13]),
        purpose: text(row[14]), type: text(row[15]), aspiration: text(row[16]), weight: text(row[17]), outputInterface: text(row[18]), headers: text(row[19]) },
      source: { sheet: "型谱表明细", row: index + 2, familyRow: familyIndex < 0 ? null : familyIndex + 1, url: text(row[20]) },
      issues: [...(!rated ? ["ambiguous_power"] : []), ...(familyIndex < 0 ? ["missing_family"] : [])] }];
  });
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.model, (counts.get(record.model) ?? 0) + 1);
  for (const record of records) if ((counts.get(record.model) ?? 0) > 1) record.issues.push("multiple_model_records");
  return catalogSnapshotSchema.parse({ version: 1, workbook: "weichai_engines.xlsx", sha256, importedOn,
    publicDisplay: "user_authorized", evidenceStatus: "source_reported_unverified", familyCount: families.length - 1, excludedHeaderRows, records });
}
