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
