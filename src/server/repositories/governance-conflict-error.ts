export class GovernanceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceConflictError";
  }
}
