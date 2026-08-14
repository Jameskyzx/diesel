import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  countryDirectorySchema,
  countryGeoFeaturePropertiesSchema,
  countryGeoIndexSchema,
} from "@/features/countries/schemas";
import { countryCatalog } from "@/server/db/seed/country-catalog";

const countryGeoJsonSchema = z
  .object({
    features: z.array(
      z
        .object({
          geometry: z.object({ type: z.string() }).passthrough(),
          properties: countryGeoFeaturePropertiesSchema,
          type: z.literal("Feature"),
        })
        .strict(),
    ),
    name: z.string(),
    type: z.literal("FeatureCollection"),
  })
  .strict();

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"),
  );
}

describe("world country map assets", () => {
  it("contains only unique ISO3 features and a matching lightweight index", async () => {
    const [geoJson, countryIndex] = await Promise.all([
      readJson("public/geo/world-countries.geojson").then((value) =>
        countryGeoJsonSchema.parse(value),
      ),
      readJson("public/geo/world-countries-index.json").then((value) =>
        countryGeoIndexSchema.parse(value),
      ),
    ]);

    const featureIso3s = geoJson.features.map(
      ({ properties }) => properties.ISO3,
    );
    const indexIso3s = countryIndex.map(({ iso3 }) => iso3);

    expect(featureIso3s).toHaveLength(177);
    expect(new Set(featureIso3s).size).toBe(featureIso3s.length);
    expect(indexIso3s).toHaveLength(featureIso3s.length);
    expect(new Set(indexIso3s).size).toBe(indexIso3s.length);
    expect(new Set(indexIso3s)).toEqual(new Set(featureIso3s));
    expect(featureIso3s).toEqual(
      expect.arrayContaining([
        "BRA",
        "CHN",
        "DEU",
        "LIE",
        "MLT",
        "SGP",
        "USA",
      ]),
    );
    const liechtenstein = geoJson.features.find(
      ({ properties }) => properties.ISO3 === "LIE",
    );
    expect(JSON.stringify(liechtenstein?.geometry)).toContain("9.521155");
    const malta = geoJson.features.find(
      ({ properties }) => properties.ISO3 === "MLT",
    );
    expect(JSON.stringify(malta?.geometry)).toContain("14.183604");
  });

  it("keeps every catalog country selectable and marks missing geometry explicitly", async () => {
    const countryIndex = await readJson(
      "public/geo/world-countries-index.json",
    ).then((value) => countryGeoIndexSchema.parse(value));
    const geometryIso3s = new Set(countryIndex.map(({ iso3 }) => iso3));
    const directory = countryDirectorySchema.parse(
      countryCatalog.map(({ iso3, nameEn }) => ({
        hasGeometry: geometryIso3s.has(iso3),
        iso3,
        name: nameEn,
      })),
    );

    expect(directory).toHaveLength(178);
    expect(directory.filter(({ hasGeometry }) => !hasGeometry)).toEqual([
      expect.objectContaining({
        hasGeometry: false,
        iso3: "MUS",
        name: "Mauritius",
      }),
    ]);
  });
});
