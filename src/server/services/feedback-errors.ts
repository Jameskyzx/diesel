/** Raised for feedback input a person can fix; the message is shown as-is. */
export class FeedbackInputError extends Error {
  constructor(readonly code: "INVALID_FILE" | "FILE_TOO_LARGE" | "EMPTY_INPUT" | "UNSUPPORTED_IN_DEMO", message: string) {
    super(message);
    this.name = "FeedbackInputError";
  }
}

/** Raised when the extraction model fails or returns no usable structure. */
export class FeedbackExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackExtractionError";
  }
}
