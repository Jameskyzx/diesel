import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const immutableGithubActionReference =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)*@[a-f0-9]{40}$/;
const immutableDockerActionReference = /^docker:\/\/[^\s@]+@sha256:[a-f0-9]{64}$/;
const immutableContainerImageReference = /^[^\s@]+@sha256:[a-f0-9]{64}$/;
const immutableContainerReason =
  "Service and job container images must use an immutable sha256 digest";
const auditableWorkflowReason =
  "Workflow jobs and steps must use auditable block mappings";
const auditableWorkflowJobIdReason =
  "Workflow job declarations must use exactly two spaces, a bare lowercase [a-z][a-z0-9-]* ID, and a bare colon";
const auditableWorkflowJobId = /^[a-z][a-z0-9-]*$/u;

export type WorkflowUseFinding = {
  file: string;
  line: number;
  reason: string;
  reference: string;
};

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function trimYamlHorizontalWhitespace(value: string): string {
  return value.replace(/^[ \t]+|[ \t]+$/gu, "");
}

function trimYamlHorizontalWhitespaceEnd(value: string): string {
  return value.replace(/[ \t]+$/u, "");
}

function stripYamlLineComment(value: string): string {
  let quote: '"' | "'" | null = null;
  let hasValue = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!hasValue && character !== undefined && !/[ \t]/u.test(character)) {
      if (character === "#") {
        return trimYamlHorizontalWhitespaceEnd(value.slice(0, index));
      }
      hasValue = true;
      if (character === '"' || character === "'") {
        quote = character;
      }
      continue;
    }
    if (quote === '"') {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (character === "'" && value[index + 1] === "'") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (
      character === "#" &&
      (index === 0 || /[ \t]/u.test(value[index - 1] ?? ""))
    ) {
      return trimYamlHorizontalWhitespaceEnd(value.slice(0, index));
    }
  }

  return trimYamlHorizontalWhitespaceEnd(value);
}

type YamlMappingLine = {
  hasEscapedKey: boolean;
  indent: number;
  key: string;
  rawKey: string;
  value: string;
};

function parseYamlMappingLine(line: string): YamlMappingLine | null {
  const match = /^([ \t]*)(?:-[ \t]*)?((?:"[^"]*"|'[^']*'|<<|[A-Za-z0-9_.-]+))[ \t]*:[ \t]*(.*?)[ \t]*$/u.exec(
    line,
  );
  if (!match) return null;

  const rawKey = match[2] ?? "";

  return {
    hasEscapedKey: rawKey.startsWith('"') && rawKey.includes("\\"),
    indent: match[1]?.length ?? 0,
    key: unquote(rawKey),
    rawKey,
    value: unquote(
      trimYamlHorizontalWhitespace(stripYamlLineComment(match[3] ?? "")),
    ),
  };
}

function isBlockScalar(value: string): boolean {
  return /^[>|][0-9+-]*$/u.test(value);
}

export function findUnpinnedWorkflowUses(
  source: string,
  file = "workflow.yml",
): WorkflowUseFinding[] {
  const findings: WorkflowUseFinding[] = [];
  const mappingStack: Array<Pick<YamlMappingLine, "indent" | "key">> = [];
  let blockScalarIndent: number | null = null;
  let rejectedMappingIndent: number | null = null;

  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (index === 0 && line.startsWith("\uFEFF")) {
      findings.push({
        file,
        line: index + 1,
        reason: auditableWorkflowReason,
        reference: line.trimStart(),
      });
      rejectedMappingIndent = /^\s*/u.exec(line)?.[0].length ?? 0;
      continue;
    }
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const indent = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (rejectedMappingIndent !== null) {
      if (indent > rejectedMappingIndent) continue;
      rejectedMappingIndent = null;
    }

    while (
      mappingStack.length > 0 &&
      (mappingStack.at(-1)?.indent ?? -1) >= indent
    ) {
      mappingStack.pop();
    }

    const trimmedStart = line.trimStart();
    if (/^(?:-\s*)?\?(?:\s|$)/u.test(trimmedStart)) {
      findings.push({
        file,
        line: index + 1,
        reason: auditableWorkflowReason,
        reference: trimmedStart,
      });
      rejectedMappingIndent = indent;
      continue;
    }

    const mapping = parseYamlMappingLine(line);
    if (!mapping) {
      const structuralParent = mappingStack.at(-1)?.key;
      const structuralGrandparent = mappingStack.at(-2)?.key;
      const isProtectedStructure =
        structuralParent === "jobs" ||
        structuralParent === "steps" ||
        structuralParent === "services" ||
        structuralParent === "container" ||
        structuralGrandparent === "jobs" ||
        structuralGrandparent === "services";
      const startsOpaqueStructure = /^(?:-|[\[\]{\}*&$!:])/u.test(
        trimmedStart,
      );
      const isBareDocumentMarker = line === "---" || line === "...";
      const isOpaqueRoot =
        mappingStack.length === 0 && !isBareDocumentMarker;

      if (
        (isProtectedStructure && startsOpaqueStructure) ||
        isOpaqueRoot
      ) {
        findings.push({
          file,
          line: index + 1,
          reason: auditableWorkflowReason,
          reference: trimmedStart,
        });
        rejectedMappingIndent = indent;
      }
      continue;
    }

    const parentMapping = mappingStack.at(-1);
    const parent = parentMapping?.key;
    const grandparent = mappingStack.at(-2)?.key;
    const hasSensitiveEscapedKey =
      mapping.hasEscapedKey &&
      (mappingStack.length === 0 ||
        parent === "steps" ||
        parent === "container" ||
        grandparent === "jobs" ||
        grandparent === "services");
    if (hasSensitiveEscapedKey) {
      findings.push({
        file,
        line: index + 1,
        reason: auditableWorkflowReason,
        reference: trimmedStart,
      });
      rejectedMappingIndent = mapping.indent;
      continue;
    }

    const isWorkflowJobDefinition =
      parent === "jobs" && mappingStack.length === 1;
    if (
      isWorkflowJobDefinition &&
      (!auditableWorkflowJobId.test(mapping.rawKey) ||
        (mapping.value === "" && line !== `  ${mapping.rawKey}:`))
    ) {
      findings.push({
        file,
        line: index + 1,
        reason: auditableWorkflowJobIdReason,
        reference: mapping.rawKey,
      });
      rejectedMappingIndent = mapping.indent;
      continue;
    }

    if (mapping.key === "uses") {
      const reference = mapping.value;
      if (reference.startsWith("./")) continue;

      if (reference.startsWith("docker://")) {
        if (!immutableDockerActionReference.test(reference)) {
          findings.push({
            file,
            line: index + 1,
            reason: "Docker actions must use an immutable sha256 digest",
            reference,
          });
        }
        continue;
      }

      if (!immutableGithubActionReference.test(reference)) {
        findings.push({
          file,
          line: index + 1,
          reason: "GitHub actions must use a full 40-character commit SHA",
          reference,
        });
      }
      continue;
    }

    const isNonBlockJobs =
      mapping.key === "jobs" &&
      mapping.value !== "" &&
      mappingStack.length === 0;
    const isNonBlockJobDefinition =
      parent === "jobs" && mapping.value !== "";
    const isNonBlockJobSteps =
      mapping.key === "steps" &&
      mapping.value !== "" &&
      grandparent === "jobs";
    const isWorkflowMerge =
      mapping.key === "<<" &&
      (mappingStack.length === 0 ||
        parent === "steps" ||
        grandparent === "jobs");
    if (
      isNonBlockJobs ||
      isNonBlockJobDefinition ||
      isNonBlockJobSteps ||
      isWorkflowMerge
    ) {
      findings.push({
        file,
        line: index + 1,
        reason: auditableWorkflowReason,
        reference: mapping.value,
      });
      rejectedMappingIndent = mapping.indent;
      continue;
    }

    const isScalarJobContainer =
      mapping.key === "container" &&
      mapping.value !== "" &&
      grandparent === "jobs";
    if (
      isScalarJobContainer &&
      !immutableContainerImageReference.test(mapping.value)
    ) {
      findings.push({
        file,
        line: index + 1,
        reason: immutableContainerReason,
        reference: mapping.value,
      });
      rejectedMappingIndent = mapping.indent;
      continue;
    }

    const isNonBlockJobServices =
      mapping.key === "services" &&
      mapping.value !== "" &&
      grandparent === "jobs";
    const isNonBlockServiceDefinition =
      parent === "services" && mapping.value !== "";
    const isContainerMerge =
      mapping.key === "<<" &&
      (parent === "container" || grandparent === "services");
    if (
      isNonBlockJobServices ||
      isNonBlockServiceDefinition ||
      isContainerMerge
    ) {
      findings.push({
        file,
        line: index + 1,
        reason: immutableContainerReason,
        reference: mapping.value,
      });
      rejectedMappingIndent = mapping.indent;
      continue;
    }

    if (mapping.key === "image") {
      const isJobContainerImage = parent === "container";
      const isServiceImage = grandparent === "services";

      if (
        (isJobContainerImage || isServiceImage) &&
        !immutableContainerImageReference.test(mapping.value)
      ) {
        findings.push({
          file,
          line: index + 1,
          reason: immutableContainerReason,
          reference: mapping.value,
        });
      }
      continue;
    }

    if (mapping.value === "") {
      mappingStack.push({ indent: mapping.indent, key: mapping.key });
    } else if (isBlockScalar(mapping.value)) {
      blockScalarIndent = mapping.indent;
    }
  }

  return findings;
}

export async function scanWorkflowActionPins(
  workflowDirectory = resolve(process.cwd(), ".github/workflows"),
): Promise<WorkflowUseFinding[]> {
  const entries = await readdir(workflowDirectory, { withFileTypes: true });
  const workflowFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")),
    )
    .map(({ name }) => name)
    .sort();

  const findings: WorkflowUseFinding[] = [];
  for (const name of workflowFiles) {
    const path = resolve(workflowDirectory, name);
    findings.push(
      ...findUnpinnedWorkflowUses(await readFile(path, "utf8"), name),
    );
  }
  return findings;
}

async function main(): Promise<void> {
  const findings = await scanWorkflowActionPins();
  if (findings.length > 0) {
    throw new Error(
      `GitHub workflow pin policy failed:\n${findings
        .map(
          ({ file, line, reason, reference }) =>
            `- ${file}:${line} ${reason}: ${reference || "<empty>"}`,
        )
        .join("\n")}`,
    );
  }

  process.stdout.write(
    "GitHub workflow pin policy passed (all remote actions and service/container images are immutable).\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
