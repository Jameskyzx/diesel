export function formatErrorTree(
  error: unknown,
  rootLabel = "error",
): string {
  const lines: string[] = [];
  const visited = new Set<object>();
  const visit = (value: unknown, label: string): void => {
    if (typeof value === "object" && value !== null) {
      if (visited.has(value)) {
        lines.push(`${label}: [cyclic error]`);
        return;
      }
      visited.add(value);
    }
    if (value instanceof AggregateError) {
      lines.push(`${label}: ${value.name}: ${value.message}`);
      for (const [index, nested] of value.errors.entries()) {
        visit(nested, `${label}.errors[${index}]`);
      }
      if (value.cause !== undefined) visit(value.cause, `${label}.cause`);
      return;
    }
    if (value instanceof Error) {
      lines.push(`${label}: ${value.name}: ${value.message}`);
      if (value.cause !== undefined) visit(value.cause, `${label}.cause`);
      return;
    }
    lines.push(`${label}: ${String(value)}`);
  };
  visit(error, rootLabel);
  return `${lines.join("\n")}\n`;
}
