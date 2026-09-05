/** Bounded transform events: fixed categories only, never input or error details. */
export interface TransformBatchDiagnostic {
  readonly event: 'transform_batch';
  mapped: number;
  processingFailed: number;
  reasons: { invalid_payload: number; schema_rejected: number };
}

/** One event per completed batch and per uncached secret read, including retries. */
export type TransformDiagnostic =
  | TransformBatchDiagnostic
  | { readonly event: 'salt_read'; readonly outcome: 'success' | 'failure' };

/** Diagnostic sinks must return normally so observation cannot change delivery. */
export type TransformDiagnostics = (event: TransformDiagnostic) => void;
