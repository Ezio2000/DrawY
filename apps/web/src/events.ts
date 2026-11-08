import type { Run, Work } from "../../../modules/contracts/index.ts";

const RETRY = 3000;

/** What the server tells a signed-in user's pages as it happens: `connected` each time the
 * stream (re)opens, so whatever was missed while it was down can be fetched again. */
export type ServerEvent =
  | { type: "connected" }
  | { type: "work"; work: Work }
  | { type: "run"; run: Run };
export interface Listener {
  event(event: ServerEvent): void;
  offline?(offline: boolean): void;
}

/** One connection per user, however many parts of the page listen: the list of works and
 * the open work each subscribe to the same stream. */
const hubs = new Map<string, { listeners: Set<Listener>; offline: boolean; stop: () => void }>();

/** Listens to the server's events for one user until the returned function is called. */
export function listen(userId: string, listener: Listener) {
  let hub = hubs.get(userId);
  if (!hub) {
    const listeners = new Set<Listener>();
    const made = {
      listeners,
      offline: false,
      stop: () => {},
    };
    made.stop = connect(
      userId,
      (event) => {
        for (const l of [...listeners]) l.event(event);
      },
      (offline) => {
        made.offline = offline;
        for (const l of [...listeners]) l.offline?.(offline);
      },
    );
    hubs.set(userId, made);
    hub = made;
  }
  hub.listeners.add(listener);
  if (hub.offline) listener.offline?.(true);
  const joined = hub;
  return () => {
    joined.listeners.delete(listener);
    if (joined.listeners.size) return;
    joined.stop();
    if (hubs.get(userId) === joined) hubs.delete(userId);
  };
}

/** The server's events for one user, over a single connection shared by all of this
 * browser's tabs. A browser keeps only a few connections open to a site, and each tab
 * listening on its own would use one up; the tab holding the lock listens and passes every
 * event on to the others, and when it closes the next tab takes over. Without the lock
 * (a page not served securely) each tab listens for itself. */
function connect(
  userId: string,
  event: (event: ServerEvent) => void,
  offline: (offline: boolean) => void,
) {
  const name = "drawy-events:" + userId;
  const channel = new BroadcastChannel(name);
  channel.onmessage = (e) =>
    "offline" in e.data ? offline(e.data.offline) : event(e.data.event);
  const stop = new AbortController();
  const hold = () =>
    new Promise<void>((release) => {
      let source: EventSource;
      let retry: ReturnType<typeof setTimeout>;
      const open = () => {
        source = new EventSource("/api/events");
        source.onmessage = (e) => {
          const data = JSON.parse(e.data);
          offline(false);
          channel.postMessage({ offline: false });
          event(data);
          channel.postMessage({ event: data });
        };
        source.onerror = () => {
          offline(true);
          channel.postMessage({ offline: true });
          // A browser retries a dropped stream by itself, but gives up for good on an error
          // response, such as the 502 from the proxy while the server restarts.
          if (source.readyState === EventSource.CLOSED)
            retry = setTimeout(open, RETRY);
        };
      };
      open();
      stop.signal.addEventListener("abort", () => {
        clearTimeout(retry);
        source.close();
        release();
      });
    });
  if (navigator.locks)
    void navigator.locks
      .request(name, { signal: stop.signal }, hold)
      .catch(() => {});
  else void hold();
  return () => {
    stop.abort();
    channel.close();
  };
}
