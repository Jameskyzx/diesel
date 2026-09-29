import { randomUUID } from "node:crypto";
import {
  constants,
  type BigIntStats,
} from "node:fs";
import {
  lstat,
  open,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  normalize,
  resolve,
} from "node:path";

const NEXT_ENVIRONMENT_MAX_BYTES = 16 * 1024;
const canonicalNextEnvironmentPattern = new RegExp(
  [
    '^/// <reference types="next" />\\n',
    '/// <reference types="next/image-types/global" />\\n',
    '(?:import "(\\./\\.next(?:-[A-Za-z0-9_-]+)?(?:/[A-Za-z0-9._-]+)*/types/)routes\\.d\\.ts";\\n',
    // Next 16.3 adds exactly one companion import from the same generated
    // directory. Keep legacy output restorable without admitting other files.
    '(?:import "\\1root-params\\.d\\.ts";\\n)?)?',
    "\\n",
    "// NOTE: This file should not be edited\\n",
    "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information\\.\\n",
    // Unlike $, this cannot accept an additional final newline.
    "(?![\\s\\S])",
  ].join(""),
  "u",
);

type NextEnvironmentFileState = Readonly<{
  bytes: Buffer;
  dev: bigint;
  ino: bigint;
  mode: number;
  mtimeNs: bigint;
  nlink: bigint;
  size: bigint;
}>;

export type NextEnvironmentFileGuard = Readonly<{
  path: string;
  recordGeneratedState: () => Promise<void>;
  restore: () => Promise<void>;
}>;

export type NextEnvironmentFileGuardOptions = Readonly<{
  allowedGeneratedRouteImports: readonly (string | null)[];
  path?: string;
}>;

function permissionMode(metadata: BigIntStats): number {
  return Number(metadata.mode & 0o777n);
}

function sameFileObservation(
  left: NextEnvironmentFileState,
  right: NextEnvironmentFileState,
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.bytes.equals(right.bytes);
}

function sameRestorableState(
  left: NextEnvironmentFileState,
  right: NextEnvironmentFileState,
): boolean {
  return left.mode === right.mode && left.bytes.equals(right.bytes);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readStableNextEnvironmentFile(
  path: string,
): Promise<NextEnvironmentFileState> {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      throw new Error(
        "next-env.d.ts must be a regular file with exactly one hard link.",
      );
    }
    if (before.size <= 0n || before.size > BigInt(NEXT_ENVIRONMENT_MAX_BYTES)) {
      throw new Error("next-env.d.ts exceeds the supported byte boundary.");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mode !== after.mode ||
      before.mtimeNs !== after.mtimeNs ||
      before.nlink !== after.nlink ||
      before.size !== after.size ||
      BigInt(bytes.byteLength) !== after.size
    ) {
      throw new Error("next-env.d.ts changed while it was being read.");
    }
    return {
      bytes,
      dev: after.dev,
      ino: after.ino,
      mode: permissionMode(after),
      mtimeNs: after.mtimeNs,
      nlink: after.nlink,
      size: after.size,
    };
  } finally {
    await handle.close();
  }
}

function canonicalRouteImport(bytes: Buffer): string | null | undefined {
  if (
    bytes.byteLength <= 0 ||
    bytes.byteLength > NEXT_ENVIRONMENT_MAX_BYTES ||
    bytes.includes(0)
  ) {
    return undefined;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    return undefined;
  }
  const match = canonicalNextEnvironmentPattern.exec(text);
  if (!match) return undefined;
  return match[1] === undefined ? null : `${match[1]}routes.d.ts`;
}

export function isCanonicalNextEnvironmentFile(bytes: Buffer): boolean {
  return canonicalRouteImport(bytes) !== undefined;
}

function resolveCanonicalAbsolutePath(pathInput: string): string {
  const resolvedPath = resolve(pathInput);
  if (!isAbsolute(resolvedPath) || normalize(resolvedPath) !== resolvedPath) {
    throw new Error("next-env.d.ts path must be a canonical absolute path.");
  }
  return resolvedPath;
}

async function resolvePhysicalPath(path: string): Promise<string> {
  const lexicalMetadata = await lstat(path, { bigint: true });
  if (lexicalMetadata.isSymbolicLink()) {
    throw new Error("next-env.d.ts must not be a symbolic link.");
  }
  const physicalParent = await realpath(dirname(path));
  const expectedPhysicalPath = resolve(physicalParent, basename(path));
  const [metadata, physicalPath] = await Promise.all([
    lstat(expectedPhysicalPath, { bigint: true }),
    realpath(path),
  ]);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1n ||
    physicalPath !== expectedPhysicalPath
  ) {
    throw new Error(
      "next-env.d.ts must resolve to a regular non-symlink file with exactly one hard link.",
    );
  }
  return physicalPath;
}

async function writeAtomicOriginal(
  path: string,
  original: NextEnvironmentFileState,
  observed: NextEnvironmentFileState,
): Promise<void> {
  const parent = dirname(path);
  const temporaryPath = resolve(
    parent,
    `.${basename(path)}.restore-${process.pid}-${randomUUID()}.tmp`,
  );
  if (dirname(temporaryPath) !== parent) {
    throw new Error("next-env.d.ts restore path escaped its parent directory.");
  }
  let temporaryCreated = false;
  try {
    const handle = await open(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      original.mode,
    );
    temporaryCreated = true;
    try {
      await handle.writeFile(original.bytes);
      await handle.chmod(original.mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const immediatelyBeforeRename = await readStableNextEnvironmentFile(path);
    if (!sameFileObservation(immediatelyBeforeRename, observed)) {
      throw new Error(
        "next-env.d.ts changed concurrently before it could be restored.",
      );
    }
    await rename(temporaryPath, path);
    temporaryCreated = false;
    await syncDirectory(parent);

    const restored = await readStableNextEnvironmentFile(path);
    if (!sameRestorableState(restored, original)) {
      throw new Error("next-env.d.ts restoration could not be verified.");
    }
  } finally {
    if (temporaryCreated) {
      await rm(temporaryPath, { force: true });
    }
  }
}

export async function createNextEnvironmentFileGuard(
  options: NextEnvironmentFileGuardOptions,
): Promise<NextEnvironmentFileGuard> {
  if (options.allowedGeneratedRouteImports.length === 0) {
    throw new Error(
      "At least one generated next-env.d.ts route import must be allowed.",
    );
  }
  const allowedGeneratedRouteImports = new Set(
    options.allowedGeneratedRouteImports,
  );
  const pathInput = options.path ?? "next-env.d.ts";
  const path = await resolvePhysicalPath(
    resolveCanonicalAbsolutePath(pathInput),
  );
  const original = await readStableNextEnvironmentFile(path);
  if (!isCanonicalNextEnvironmentFile(original.bytes)) {
    throw new Error(
      "The original next-env.d.ts is not recognized as canonical Next.js output.",
    );
  }
  const generatedStates: NextEnvironmentFileState[] = [];
  let restored = false;
  let restorePromise: Promise<void> | null = null;

  return {
    path,
    async recordGeneratedState() {
      if (restorePromise !== null) {
        throw new Error(
          "next-env.d.ts generated state cannot be recorded after restoration began.",
        );
      }
      const generated = await readStableNextEnvironmentFile(path);
      if (restorePromise !== null) {
        throw new Error(
          "next-env.d.ts generated state cannot be recorded after restoration began.",
        );
      }
      const generatedRouteImport = canonicalRouteImport(generated.bytes);
      if (
        !sameRestorableState(generated, original) &&
        (generatedRouteImport === undefined ||
          !allowedGeneratedRouteImports.has(generatedRouteImport))
      ) {
        throw new Error(
          "next-env.d.ts contains output outside this operation's allowlist; refusing to record or overwrite it.",
        );
      }
      if (
        !generatedStates.some((candidate) =>
          sameRestorableState(candidate, generated)
        )
      ) {
        generatedStates.push(generated);
      }
    },
    restore() {
      restorePromise ??= (async () => {
        if (restored) return;
        const current = await readStableNextEnvironmentFile(path);
        if (sameRestorableState(current, original)) {
          restored = true;
          return;
        }
        if (
          !generatedStates.some((candidate) =>
            sameRestorableState(candidate, current)
          )
        ) {
          throw new Error(
            "next-env.d.ts changed outside the controlled Next.js operation; refusing to overwrite it.",
          );
        }
        await writeAtomicOriginal(path, original, current);
        restored = true;
      })();
      return restorePromise;
    },
  };
}

export async function restoreNextEnvironmentAfterOperation(
  guard: NextEnvironmentFileGuard,
): Promise<void> {
  await guard.recordGeneratedState();
  await guard.restore();
}

export async function restoreRecordedNextEnvironmentAfterOperation(
  guard: NextEnvironmentFileGuard,
): Promise<void> {
  await guard.restore();
}

export async function restoreNextEnvironmentAfterFailure(
  guard: NextEnvironmentFileGuard,
  operationError: unknown,
): Promise<never> {
  try {
    await guard.recordGeneratedState();
    await guard.restore();
  } catch (restoreError: unknown) {
    throw new AggregateError(
      [operationError, restoreError],
      "Next.js operation and next-env.d.ts restoration both failed.",
    );
  }
  throw operationError;
}

export async function restoreRecordedNextEnvironmentAfterFailure(
  guard: NextEnvironmentFileGuard,
  operationError: unknown,
): Promise<never> {
  try {
    await guard.restore();
  } catch (restoreError: unknown) {
    throw new AggregateError(
      [operationError, restoreError],
      "Next.js operation and next-env.d.ts restoration both failed.",
    );
  }
  throw operationError;
}
