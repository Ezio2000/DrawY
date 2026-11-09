import type { Run, Work } from "../../../modules/contracts/index.ts";

const RETRY = 3000;
/** How long a stream may go without a word before it is taken to be dead: the server pings
 * every 20 seconds. */
const QUIET = 45_000;

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
 * (a page not served securely) each tab listens for itself.
 *
 * A phone stops a page that is not in front: its stream goes quiet without failing, and a
 * tab put away while holding the lock would keep it, so the tab in front would never hear
 * a run end. So only a page that is shown listens: hidden, it lets the stream and the lock
 * go, and shown again it takes them back, its stream opening with `connected`, on which
 * whatever was missed is fetched. A stream that has heard nothing, not even the server's
 * ping, for longer than the server lets pass is taken to be dead and opened afresh. */
function connect(
  userId: string,
  event: (event: ServerEvent) => void,
  offline: (offline: boolean) => void,
) {
  const name = "drawy-events:" + userId;
  const channel = new BroadcastChannel(name);
  channel.onmessage = (e) =>
    "offline" in e.data ? offline(e.data.offline) : event(e.data.event);
  let turn: AbortController | undefined;
  const hold = (signal: AbortSignal) => () =>
    new Promise<void>((release) => {
      let source: EventSource | undefined;
      let retry: ReturnType<typeof setTimeout>, quiet: ReturnType<typeof setTimeout>;
      const heard = () => {
        clearTimeout(quiet);
        quiet = setTimeout(reopen, QUIET);
      };
      const down = () => {
        offline(true);
        channel.postMessage({ offline: true });
      };
      const reopen = () => {
        source?.close();
        down();
        open();
      };
      const open = () => {
        clearTimeout(retry);
        source = new EventSource("/api/events");
        heard();
        source.onmessage = (e) => {
          heard();
          const data = JSON.parse(e.data);
          offline(false);
          channel.postMessage({ offline: false });
          event(data);
          channel.postMessage({ event: data });
        };
        source.addEventListener("ping", heard);
        source.onerror = () => {
          down();
          // A browser retries a dropped stream by itself, but gives up for good on an error
          // response, such as the 502 from the proxy while the server restarts.
          if (source?.readyState === EventSource.CLOSED) retry = setTimeout(open, RETRY);
        };
      };
      open();
      signal.addEventListener("abort", () => {
        clearTimeout(retry);
        clearTimeout(quiet);
        source?.close();
        release();
      });
    });
  /** Listens (or waits for the lock to) while the page is shown. */
  const start = () => {
    if (turn || document.hidden) return;
    const mine = (turn = new AbortController());
    if (navigator.locks)
      void navigator.locks.request(name, { signal: mine.signal }, hold(mine.signal)).catch(() => {});
    else void hold(mine.signal)();
  };
  const pause = () => {
    turn?.abort();
    turn = undefined;
  };
  /** The page shown again, or the network back: a stream that may have died unheard is
   * opened afresh. */
  const restart = () => {
    pause();
    start();
  };
  const shown = () => (document.hidden ? pause() : restart());
  document.addEventListener("visibilitychange", shown);
  // A page brought back from the back-forward cache.
  const back = (e: PageTransitionEvent) => e.persisted && restart();
  addEventListener("pageshow", back);
  addEventListener("online", restart);
  start();
  return () => {
    document.removeEventListener("visibilitychange", shown);
    removeEventListener("pageshow", back);
    removeEventListener("online", restart);
    pause();
    channel.close();
  };
}
