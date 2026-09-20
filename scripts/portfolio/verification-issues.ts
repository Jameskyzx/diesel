import { isDeepStrictEqual } from "node:util";

function equalityIssue(
  actual: unknown,
  expected: unknown,
  label: string,
): string | null {
  return isDeepStrictEqual(actual, expected)
    ? null
    : `${label} drifted. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`;
}

export class VerificationIssues {
  readonly #issues: string[] = [];

  add(message: string): void {
    this.#issues.push(message);
  }

  equal(actual: unknown, expected: unknown, label: string): void {
    const issue = equalityIssue(actual, expected, label);
    if (issue !== null) {
      this.add(issue);
    }
  }

  list(): readonly string[] {
    return [...this.#issues];
  }

  throwIfAny(context: string): void {
    if (this.#issues.length === 0) {
      return;
    }
    throw new Error(
      `${context} found ${this.#issues.length} issue${this.#issues.length === 1 ? "" : "s"}:\n` +
        this.#issues.map((issue) => `- ${issue}`).join("\n"),
    );
  }
}

export function assertVerificationEqual(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  const issue = equalityIssue(actual, expected, label);
  if (issue !== null) {
    throw new Error(issue);
  }
}
