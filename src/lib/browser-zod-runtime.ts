import { z } from "zod";

/**
 * Zod's object-schema fast path probes `new Function` unless jitless mode is
 * configured before the first browser parse. Strict CSP records that caught
 * probe as a real violation, so the public client runtime opts out of JIT.
 */
export function configureBrowserZodRuntime(): void {
  z.config({ jitless: true });
}
