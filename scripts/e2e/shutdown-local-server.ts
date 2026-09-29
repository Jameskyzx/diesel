export async function requestLocalServerShutdown(
  url: string,
  label: string,
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${label} shutdown failed with ${response.status}.`);
  }
}
