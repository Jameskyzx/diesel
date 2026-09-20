export function appendDocumentMetadata(
  formData: FormData,
  prefix = "",
): void {
  const value = (name: string) =>
    String(formData.get(`${prefix}${name}`) ?? "");
  const rawDemoValue = formData.get(`${prefix}isDemo`);
  const isDemo = rawDemoValue === "true" || rawDemoValue === "on";
  const sourceType = value("sourceType") || "other";

  formData.set("title", value("title"));
  formData.set("documentType", value("documentType") || "other");
  formData.set("languageCode", value("languageCode") || "en");
  formData.set("sourceTitle", value("sourceTitle"));
  formData.set(
    "sourceType",
    isDemo && sourceType === "other" ? "demo" : sourceType,
  );
  formData.set("isDemo", String(isDemo));
  formData.set("demoNotice", value("demoNotice"));
}

const reprocessMetadataFields = [
  "applicationScope",
  "canonicalUrl",
  "countryIso3",
  "demoNotice",
  "documentType",
  "isDemo",
  "jurisdictionId",
  "languageCode",
  "licenseCode",
  "publishedOn",
  "redistributionAllowed",
  "sourcePublisher",
  "sourceTitle",
  "sourceType",
  "sourceUrl",
  "title",
  "validFrom",
  "validTo",
] as const;

export function appendDocumentReprocessMetadata(formData: FormData): void {
  for (const field of reprocessMetadataFields) {
    const sourceField = `reprocess${field}`;
    if (!formData.has(sourceField)) continue;

    const value = formData.get(sourceField);
    if (typeof value === "string") {
      formData.set(field, value);
    }
  }
}
