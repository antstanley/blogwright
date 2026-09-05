/** Lambda captures these structured console lines in the owned transform log group. */
import type { TransformDiagnostics } from '../transform/diagnostics.js';

/** The writer is injected for adapter tests; the composition root binds console. */
export function createTransformDiagnostics(write: (line: string) => void): TransformDiagnostics {
  return (event) => write(JSON.stringify(event));
}
