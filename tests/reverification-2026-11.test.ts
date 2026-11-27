import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  acceptanceFixtureIds,
  fixtureSources,
  fixtureSourcesAddedNovember2026,
  baseFixtureSources,
} from "@/server/db/seed/acceptance-fixtures";
import {
  fixtureMarketSources,
  baseMarketSources,
} from "@/server/db/seed/accepted-market-fixtures";
import { countryCatalog } from "@/server/db/seed/country-catalog";
import {
  NOVEMBER_2026_REVERIFICATION_ISO,
  november2026CorrectedSourceIds,
  november2026ReverifiedCountryIso3,
  november2026ReverifiedSourceIds,
  november2026StillStaleCountryIso3,
} from "@/server/db/seed/reverification-2026-11";

const november = new Date(NOVEMBER_2026_REVERIFICATION_ISO);

/** Minimal RFC 4180 reader (CRLF rows; quoted fields may hold commas, quotes, newlines). */
function readCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" && content[index + 1] === "\n") {
      continue;
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((cells) =>
    Object.fromEntries(
      header!.map((name, column) => [name, cells[column] ?? ""]),
    ),
  );
}

const evidence = readCsv(
  readFileSync("docs/evidence/reverification-2026-11.csv", "utf8"),
);

describe("November 2026 re-verification", () => {
  it("covers every fixture source in the evidence and re-verifies exactly the write_back=yes rows", () => {
    const fixtureIds = [...baseFixtureSources, ...baseMarketSources].map(
      (source) => source.id,
    );
    expect(evidence).toHaveLength(341);
    expect(new Set(evidence.map((row) => row.source_id))).toEqual(
      new Set(fixtureIds),
    );
    const writeBack = evidence
      .filter((row) => row.write_back === "yes")
      .map((row) => row.source_id);
    expect(writeBack).toHaveLength(247);
    expect(new Set(writeBack)).toEqual(november2026ReverifiedSourceIds);
    const held = evidence
      .filter((row) => row.write_back === "hold")
      .map((row) => row.source_id);
    expect(new Set(held)).toEqual(november2026CorrectedSourceIds);
    expect(held).toHaveLength(5);
  });

  it.each([
    [
      "accepted",
      baseFixtureSources,
      fixtureSources.slice(0, baseFixtureSources.length),
      245,
    ],
    [
      "market",
      baseMarketSources,
      // TÜİK (TUR) was added after the re-verification and is appended last.
      fixtureMarketSources.slice(0, baseMarketSources.length),
      7,
    ],
  ] as const)(
    "moves only verifiedAt and updatedAt of the re-verified %s sources",
    (_label, before, published, reverifiedCount) => {
      expect(published).toHaveLength(before.length);
      let moved = 0;
      before.forEach((source, index) => {
        if (
          november2026ReverifiedSourceIds.has(source.id!) ||
          november2026CorrectedSourceIds.has(source.id!)
        ) {
          moved += 1;
          // The production guard rejects any source date that moves backwards.
          expect(source.verifiedAt.getTime()).toBeLessThanOrEqual(
            november.getTime(),
          );
          expect(published[index]).toEqual({
            ...source,
            updatedAt: november,
            verifiedAt: november,
          });
        } else {
          expect(published[index]).toBe(source);
        }
      });
      expect(moved).toBe(reverifiedCount);
    },
  );

  it("appends only the Canada Interim Order and Peru D.S. 003-2024-EM sources found during the re-verification", () => {
    expect(fixtureSources).toHaveLength(
      baseFixtureSources.length + fixtureSourcesAddedNovember2026.length,
    );
    expect(fixtureSources.slice(baseFixtureSources.length)).toEqual(
      fixtureSourcesAddedNovember2026,
    );
    expect(fixtureSourcesAddedNovember2026).toHaveLength(2);
    expect(fixtureSourcesAddedNovember2026[0]).toMatchObject({
      createdAt: november,
      id: acceptanceFixtureIds.source.canadaInterimOrder2026,
      publishedOn: "2026-10-31",
      url: "https://gazette.gc.ca/rp-pr/p1/2026/2026-10-31/html/notice-avis-eng.html",
      verifiedAt: november,
    });
    expect(fixtureSourcesAddedNovember2026[1]).toMatchObject({
      createdAt: november,
      id: acceptanceFixtureIds.source.peruDs0032024Em,
      publishedOn: "2024-02-02",
      url: "https://cdn.www.gob.pe/uploads/document/file/5811876/5156101-ds-003-2024-em.pdf",
      verifiedAt: november,
    });
    // A new source must not reuse an id that the evidence already covers.
    for (const added of fixtureSourcesAddedNovember2026) {
      expect(evidence.some((row) => row.source_id === added.id)).toBe(false);
    }
  });

  it("splits the 178-country catalogue into 158 re-verified and 20 still-stale countries", () => {
    const catalog = countryCatalog.map((country) => country.iso3).sort();
    const reverified = [...november2026ReverifiedCountryIso3];
    const stillStale = [...november2026StillStaleCountryIso3];
    expect(reverified).toHaveLength(158);
    expect(stillStale).toHaveLength(20);
    // Peru was held only for its data correction, which this release makes.
    expect(reverified).toContain("PER");
    expect(new Set([...reverified, ...stillStale]).size).toBe(178);
    expect([...reverified, ...stillStale].sort()).toEqual(catalog);
  });
});
