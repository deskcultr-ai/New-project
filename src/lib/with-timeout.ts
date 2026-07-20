/** Race a promise against a timeout so a stalled network call can never hang a UI forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = "Request timed out. Check your connection and try again."): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}
