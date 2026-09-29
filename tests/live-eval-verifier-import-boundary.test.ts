import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const workspace = process.cwd();

function resolveLocalModule(importer: string, specifier: string): string | null {
  const unresolved = specifier.startsWith("@/")
    ? resolve(workspace, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(importer), specifier)
      : null;
  if (unresolved === null) {
    return null;
  }
  const candidates = extname(unresolved)
    ? [unresolved]
    : [
        `${unresolved}.ts`,
        `${unresolved}.tsx`,
        resolve(unresolved, "index.ts"),
        resolve(unresolved, "index.tsx"),
      ];
  return candidates.find(existsSync) ?? null;
}

function runtimeLocalImports(filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) {
        continue;
      }
      if (
        clause?.name === undefined &&
        clause?.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.every((element) => element.isTypeOnly)
      ) {
        continue;
      }
      specifiers.push(statement.moduleSpecifier.text);
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }

  return specifiers.flatMap((specifier) => {
    const resolved = resolveLocalModule(filePath, specifier);
    return resolved === null ? [] : [resolved];
  });
}

function collectRuntimeImportTree(entryPath: string): Set<string> {
  const visited = new Set<string>();
  const pending = [entryPath];
  while (pending.length > 0) {
    const filePath = pending.pop();
    if (filePath === undefined || visited.has(filePath)) {
      continue;
    }
    visited.add(filePath);
    pending.push(...runtimeLocalImports(filePath));
  }
  return visited;
}

describe("live-eval isolated verifier import boundary", () => {
  it("keeps the receipt verifier outside runner, provider, and service paths", () => {
    const tree = collectRuntimeImportTree(
      resolve(workspace, "scripts/ai/live-eval-receipt-verifier.ts"),
    );
    const relativePaths = [...tree].map((filePath) =>
      relative(workspace, filePath).replaceAll("\\", "/")
    );

    expect(relativePaths).not.toContain("scripts/ai/live-eval.ts");
    expect(relativePaths).not.toContain("src/server/ai/model.ts");
    expect(relativePaths).not.toContain("src/server/ai/sales-chat.ts");
    expect(
      relativePaths.filter((filePath) =>
        filePath.startsWith("src/server/services/")
      ),
    ).toEqual([]);
    expect(relativePaths).toContain("src/domain/ai/evidence-gap-response.ts");
  });
});
