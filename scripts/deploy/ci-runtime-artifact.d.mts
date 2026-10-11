export type RuntimeMetadata = {
  format: "diesel-ci-runtime-v1";
  release: string;
  platform: "linux";
  arch: "x64";
  node: "v22.22.3";
  ubuntu: "22.04";
  inputDigest: string;
  artifactDigest: string;
  archiveSha256: string;
  archiveBytes: number;
};
export function parseRuntimeMetadata(value: unknown, release: string): RuntimeMetadata;
export function hashFile(path: string): Promise<string>;
export function runtimeReadyArguments(release: string, runtimeUid: string, runtimeGid: string): string[];
export function verifyStaged(release: string, directory: string): Promise<RuntimeMetadata>;
