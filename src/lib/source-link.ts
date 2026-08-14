/**
 * Only verified HTTP(S) locations are rendered as outbound evidence links.
 * RFC 2606 `.invalid` URLs are deliberately used by fictional Demo fixtures
 * and must remain visible as labels without becoming dead links.
 */
export function isNavigableEvidenceUrl(
  value: string | null | undefined,
): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      hostname !== "invalid" &&
      !hostname.endsWith(".invalid")
    );
  } catch {
    return false;
  }
}
