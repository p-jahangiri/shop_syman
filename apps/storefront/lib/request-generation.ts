/**
 * Invalidate earlier asynchronous reads using the current counter, including at
 * cleanup. This is a request generation, not a DOM ref whose node is captured.
 */
export function advanceRequestGeneration(generation: { current: number }): number {
  return ++generation.current;
}
