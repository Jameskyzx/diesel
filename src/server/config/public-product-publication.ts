import "server-only";

type PublicationCandidate = {
  id: string;
  isDemo: boolean;
  source: {
    id: string;
    isDemo: boolean;
  };
};

type ProductPublicationCandidate = PublicationCandidate & {
  specificationVersion: string;
};

type ProductApproval = {
  sourceId: string;
  specificationVersion: string;
};

type CertificationApproval = {
  sourceId: string;
};

/**
 * Public real-product evidence is fail-closed. IDs may be added only after the
 * product or certification has completed the approval process documented in
 * docs/PRODUCT_EVIDENCE.md. Product approval binds the reviewed entity,
 * evidence source and specification version so later source/version drift
 * fails closed. The current approved real-data manifests are empty.
 */
const approvedRealProducts: Readonly<Record<string, ProductApproval>> = {};
const approvedRealCertifications: Readonly<
  Record<string, CertificationApproval>
> = {};

export function getApprovedRealProductIds(): readonly string[] {
  return Object.keys(approvedRealProducts).sort();
}

export function getApprovedRealCertificationIds(): readonly string[] {
  return Object.keys(approvedRealCertifications).sort();
}

export function isPublicProductApproved(
  product: ProductPublicationCandidate,
): boolean {
  if (product.isDemo) {
    return product.source.isDemo;
  }

  const approval = approvedRealProducts[product.id];
  return (
    !product.source.isDemo &&
    approval?.sourceId === product.source.id &&
    approval.specificationVersion === product.specificationVersion
  );
}

export function isPublicCertificationApproved(
  certification: PublicationCandidate,
): boolean {
  if (certification.isDemo) {
    return certification.source.isDemo;
  }

  return (
    !certification.source.isDemo &&
    approvedRealCertifications[certification.id]?.sourceId ===
      certification.source.id
  );
}
