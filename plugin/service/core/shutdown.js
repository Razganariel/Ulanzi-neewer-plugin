/**
 * Leaving the service without losing the last command.
 *
 * Writing the settings is debounced by a second, and that timer is unref'd on purpose:
 * a settings write must never be the reason a plugin process refuses to end. The cost of
 * that choice is that the write has no hold on the process, so if the process goes away
 * between a dial notch and the write, the notch is lost and the next start shows the
 * deck somewhere the user never put it.
 *
 * Every way out of the process therefore has to write first, not just the polite ones:
 * the signals we can catch, and the exit event, which also covers the host simply closing
 * the websocket and the event loop running dry on its own.
 */

/**
 * @param {import('./devices.js').DeviceRegistry} registry
 * @param {{emitter?: EventEmitter, exit?: (code: number) => void}} [options]
 * @returns {{flush: () => void}} the flush used on the way out, for reuse and for tests
 */
export function installShutdownHandlers(registry, options = {}) {
  const emitter = options.emitter || process;
  const exit = options.exit || ((code) => emitter.exit(code));

  /** Written last, never allowed to throw: this runs while the process is ending. */
  const flush = () => {
    try {
      registry.flush();
    } catch {
      /* exiting anyway, and there is nothing left to report it to */
    }
  };

  // SIGINT is what a terminal or the host's own quit sends. SIGTERM is the same request
  // from anything that terminates politely instead.
  emitter.on('SIGINT', () => {
    registry.stopAll();
    exit(0);
  });
  emitter.on('SIGTERM', () => {
    registry.stopAll();
    exit(0);
  });

  // The catch-all: the host closing the socket, the loop running dry, an explicit exit.
  emitter.on('exit', flush);

  return { flush };
}
