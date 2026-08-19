import { describe, expect, it } from "vitest";

import {
  getApprovedRealCertificationIds,
  getApprovedRealProductIds,
  isCertificationApprovedByManifest,
  isProductApprovedByManifest,
  isPublicCertificationApproved,
  isPublicProductApproved,
} from "@/server/config/public-product-publication";

const productId = "10000000-0000-4000-8000-000000000001";
const certificationId = "10000000-0000-4000-8000-000000000002";
const sourceId = "10000000-0000-4000-8000-000000000003";

function productCandidate(
  overrides: Partial<{
    id: string;
    isDemo: boolean;
    sourceId: string;
    sourceIsDemo: boolean;
    specificationVersion: string;
  }> = {},
) {
  return {
    id: overrides.id ?? productId,
    isDemo: overrides.isDemo ?? false,
    source: {
      id: overrides.sourceId ?? sourceId,
      isDemo: overrides.sourceIsDemo ?? false,
    },
    specificationVersion: overrides.specificationVersion ?? "2026-08-v1",
  };
}

function certificationCandidate(
  overrides: Partial<{
    id: string;
    isDemo: boolean;
    sourceId: string;
    sourceIsDemo: boolean;
  }> = {},
) {
  return {
    id: overrides.id ?? certificationId,
    isDemo: overrides.isDemo ?? false,
    source: {
      id: overrides.sourceId ?? sourceId,
      isDemo: overrides.sourceIsDemo ?? false,
    },
  };
}

describe("public product publication policy", () => {
  it("keeps the production real-data manifests empty", () => {
    expect(getApprovedRealProductIds()).toEqual([]);
    expect(getApprovedRealCertificationIds()).toEqual([]);
    expect(isPublicProductApproved(productCandidate())).toBe(false);
    expect(isPublicCertificationApproved(certificationCandidate())).toBe(false);
    expect(
      isPublicProductApproved(
        productCandidate({ isDemo: true, sourceIsDemo: true }),
      ),
    ).toBe(true);
    expect(
      isPublicCertificationApproved(
        certificationCandidate({ isDemo: true, sourceIsDemo: true }),
      ),
    ).toBe(true);
    expect(
      isPublicProductApproved(
        productCandidate({ isDemo: true, sourceIsDemo: false }),
      ),
    ).toBe(false);
    expect(
      isPublicCertificationApproved(
        certificationCandidate({ isDemo: true, sourceIsDemo: false }),
      ),
    ).toBe(false);
  });

  it.each([
    ["matching Demo product and source", true, true, true],
    ["Demo product with a real source", true, false, false],
    ["real product with a Demo source", false, true, false],
  ] as const)("handles %s", (_label, isDemo, sourceIsDemo, expected) => {
    expect(
      isProductApprovedByManifest(
        productCandidate({ isDemo, sourceIsDemo }),
        {},
      ),
    ).toBe(expected);
  });

  it.each([
    ["exact approval", {}, true],
    ["unlisted entity", { id: "unlisted-product" }, false],
    ["source drift", { sourceId: "changed-source" }, false],
    ["specification drift", { specificationVersion: "2026-08-v2" }, false],
  ] as const)("fails closed for real products on %s", (_label, overrides, expected) => {
    expect(
      isProductApprovedByManifest(productCandidate(overrides), {
        [productId]: {
          sourceId,
          specificationVersion: "2026-08-v1",
        },
      }),
    ).toBe(expected);
  });

  it.each([
    ["matching Demo certification and source", true, true, true],
    ["Demo certification with a real source", true, false, false],
    ["real certification with a Demo source", false, true, false],
  ] as const)("handles %s", (_label, isDemo, sourceIsDemo, expected) => {
    expect(
      isCertificationApprovedByManifest(
        certificationCandidate({ isDemo, sourceIsDemo }),
        {},
      ),
    ).toBe(expected);
  });

  it.each([
    ["exact approval", {}, true],
    ["unlisted entity", { id: "unlisted-certification" }, false],
    ["source drift", { sourceId: "changed-source" }, false],
  ] as const)(
    "fails closed for real certifications on %s",
    (_label, overrides, expected) => {
      expect(
        isCertificationApprovedByManifest(
          certificationCandidate(overrides),
          {
            [certificationId]: { sourceId },
          },
        ),
      ).toBe(expected);
    },
  );
});
