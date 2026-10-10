/**
 * A stand-in for the `ws` package.
 *
 * The real one is a native dependency the repository does not install; the plugin only
 * reaches it through the SDK, and in a test there is no UlanziStudio on the other end of
 * the socket anyway. This records what the SDK tried to do so a test can assert on it,
 * and never opens a connection.
 */

export const sent = [];
export const opened = [];

export default class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    this.onopen = null;
    this.onerror = null;
    this.onclose = null;
    this.onmessage = null;
    opened.push(this);
  }

  send(data) {
    sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    if (typeof this.onclose === 'function') this.onclose({ code: 1000 });
  }

  addEventListener() {}
  removeEventListener() {}
}
