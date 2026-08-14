/**
 * Normalize PostgreSQL constraint definitions for semantic smoke assertions.
 *
 * pg_get_constraintdef may add redundant quotes, whitespace, or one or more
 * parenthesis layers across PostgreSQL versions. None of those characters
 * change the constraints asserted by the smoke tests.
 */
export function normalizePostgresConstraintDefinition(
  definition: string,
): string {
  return definition.replace(/[\s"()]/gu, "").toLowerCase();
}
