/** Resolves the class names a package writes against the stylesheets it draws on. A name
 * that sheets define takes each one's scoped name, so a package's own rules and a shared
 * vocabulary meet on one element; a name none defines — a hook a library such as React Flow
 * reads, or a name a caller has already resolved — passes through as written. */
export function classes(...sheets: Readonly<Record<string, string>>[]) {
  const resolved = new Map<string, string>();
  return (...names: (string | false | null | undefined)[]) => {
    const key = names.filter(Boolean).join(" ");
    let out = resolved.get(key);
    if (out === undefined) {
      out = key
        .split(/\s+/)
        .filter(Boolean)
        .flatMap((name) => {
          const scoped = sheets.flatMap((s) =>
            Object.hasOwn(s, name) ? [s[name]] : [],
          );
          return scoped.length ? scoped : [name];
        })
        .join(" ");
      resolved.set(key, out);
    }
    return out;
  };
}
