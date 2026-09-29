import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requireFromHere = createRequire(import.meta.url);
const tsxPackagePath = requireFromHere.resolve("tsx/package.json");
const requireFromTsx = createRequire(tsxPackagePath);
const expectedEsbuildVersion = "0.28.1";

if (process.env.ESBUILD_BINARY_PATH !== undefined) {
  throw new Error(
    "ESBUILD_BINARY_PATH must not be set while building release authorization",
  );
}

const esbuild = requireFromTsx("esbuild");
if (esbuild.version !== expectedEsbuildVersion) {
  throw new Error(
    `Release authorization requires esbuild ${expectedEsbuildVersion}; resolved ${String(esbuild.version)}`,
  );
}

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultOutput = resolve(
  repositoryRoot,
  "scripts/deploy/verify-release-authorization.bundle.mjs",
);

function parseOptions(arguments_) {
  let metafile;
  let outfile = defaultOutput;
  let seenOutfile = false;

  for (const argument of arguments_) {
    if (argument.startsWith("--metafile=")) {
      if (metafile !== undefined) {
        throw new Error("--metafile may only be provided once");
      }
      metafile = argument.slice("--metafile=".length);
      continue;
    }
    if (argument.startsWith("--outfile=")) {
      if (seenOutfile) {
        throw new Error("--outfile may only be provided once");
      }
      seenOutfile = true;
      outfile = argument.slice("--outfile=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (outfile.length === 0 || (metafile !== undefined && metafile.length === 0)) {
    throw new Error("Output paths must not be empty");
  }

  const resolvedOptions = {
    metafile:
      metafile === undefined
        ? undefined
        : isAbsolute(metafile)
          ? metafile
          : resolve(repositoryRoot, metafile),
    outfile: isAbsolute(outfile) ? outfile : resolve(repositoryRoot, outfile),
  };
  if (resolvedOptions.metafile === resolvedOptions.outfile) {
    throw new Error("--metafile and --outfile must identify different files");
  }
  return resolvedOptions;
}

const options = parseOptions(process.argv.slice(2));
const result = await esbuild.build({
  absWorkingDir: repositoryRoot,
  bundle: true,
  entryPoints: ["scripts/deploy/verify-release-authorization.ts"],
  format: "esm",
  legalComments: "eof",
  metafile: options.metafile !== undefined,
  minify: true,
  outfile: options.outfile,
  platform: "node",
  target: "node22",
});

if (options.metafile !== undefined) {
  await writeFile(options.metafile, `${JSON.stringify(result.metafile, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}
