/** A request for an unconditional approval is not a request to retrieve sources. */
export function requestsSalesGuarantee(text: string): boolean {
  return text.split(/[,，。;；\n]/u).some(clause =>
    !/(?:不(?:要|用|必)|无需|不能|无法|do not|don't|cannot|can't|no)\s*(?:直接)?\s*(?:保证|guarantee)/iu.test(clause) &&
    /(?:保证.{0,60}(?:合法|合规|销售|准入)|\bguarantee\b.{0,100}\b(?:legal|sale|sell|compliance|approval)\b)/iu.test(clause));
}
