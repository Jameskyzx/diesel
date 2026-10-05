import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
if (process.env.ESBUILD_BINARY_PATH !== undefined || esbuild.version !== "0.28.1") {
  throw new Error("Durable release requires the locked esbuild 0.28.1 runtime");
}
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !args[0].startsWith("--outfile="))) {
  throw new Error("usage: build-durable-release.mjs [--outfile=path]");
}
await esbuild.build({
  absWorkingDir: root, bundle: true, entryPoints: ["scripts/deploy/durable-release.ts"],
  format: "esm", legalComments: "eof", minify: true, platform: "node", target: "node22",
  footer: { js: `/* Bundled Zod license:\n${await readFile(resolve(root, "node_modules/zod/LICENSE"), "utf8")}\n*/` },
  outfile: resolve(root, args[0]?.slice("--outfile=".length) || "scripts/deploy/durable-release.bundle.mjs"),
});
