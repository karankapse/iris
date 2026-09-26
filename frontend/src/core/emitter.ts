/** A tiny typed event emitter. Modules use it to implement their `on(handler)` methods. */
export function createEmitter<T>() {
  const handlers = new Set<(value: T) => void>();
  return {
    emit(value: T) {
      handlers.forEach((h) => h(value));
    },
    /** Returns an unsubscribe function. */
    on(handler: (value: T) => void): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
