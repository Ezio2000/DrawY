/** The server's events for one user, over a single connection shared by all of this
 * browser's tabs. A browser keeps only a few connections open to a site, and each tab
 * listening on its own would use one up; the tab holding the lock listens and passes every
 * event on to the others, and when it closes the next tab takes over. Without the lock
 * (a page not served securely) each tab listens for itself. */
export function listen(
  userId: string,
  event: (event: any) => void,
  offline: (offline: boolean) => void,
) {
  const name = "drawy-events:" + userId;
  const channel = new BroadcastChannel(name);
  channel.onmessage = (e) =>
    "offline" in e.data ? offline(e.data.offline) : event(e.data.event);
  const stop = new AbortController();
  const connect = () =>
    new Promise<void>((release) => {
      const source = new EventSource("/api/events");
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
      };
      stop.signal.addEventListener("abort", () => {
        source.close();
        release();
      });
    });
  if (navigator.locks)
    void navigator.locks
      .request(name, { signal: stop.signal }, connect)
      .catch(() => {});
  else void connect();
  return () => {
    stop.abort();
    channel.close();
  };
}
