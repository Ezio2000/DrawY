export async function api<T = any>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    headers:
      data instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
  });
  if (!r.ok) {
    const err = await r.json();
    throw Error(err.error);
  }
  return r.json();
}
