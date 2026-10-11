export function selectRuntimeArtifact(response: unknown, authorization: {
  commit: string;
  workflow: { runId: number; runAttempt: number };
}): {
  id: number;
  digest: string;
  size_in_bytes: number;
  expired: false;
  name: string;
  workflow_run: { id: number; head_sha: string; head_branch: "master" };
};
