import { expect, it } from "vitest";

import { portfolioPublicationSummary, portfolioReleaseCountryIso3s } from "@/domain/portfolio-evidence";
import { buildFixtureLimits } from "@/server/db/seed/acceptance-fixtures";
import { getApprovedRealCertificationIds, getApprovedRealProductIds } from "@/server/config/public-product-publication";
import { buildFullIngestSelection } from "../scripts/db/fixture-target-selection";

it("binds public home metrics to the signed publication closure and approved product manifest", () => {
  const selection = buildFullIngestSelection(portfolioReleaseCountryIso3s, buildFixtureLimits());
  expect(portfolioPublicationSummary).toEqual({
    approvedRealCertifications: getApprovedRealCertificationIds().length,
    approvedRealProducts: getApprovedRealProductIds().length,
    jurisdictions: selection.jurisdictionIds.size,
    regulations: selection.regulationIds.size,
    limits: selection.limitRows.length,
    sources: selection.sourceIds.size,
  });
});
