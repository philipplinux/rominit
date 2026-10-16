// Debug trace for flashes: every protocol call with its arguments, result or error and duration,
// so a failed run shows when and where it stopped. Plain JS, no browser APIs (the CLI reuses it).

/** Short, safe text for a value: blobs and bytes by size, long strings cut. @param {any} value @returns {string} */
export function summarize(value) {
  if (value === undefined || value === null) return String(value);
  if (typeof value === 'string') return JSON.stringify(value.length > 200 ? `${value.slice(0, 200)}…(${value.length})` : value);
  if (typeof value !== 'object') return String(value);
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `${value.constructor.name}(${'name' in value ? `${value.name}, ` : ''}${value.size} B)`;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `bytes(${value.byteLength})`;
  if (Array.isArray(value)) return `[${value.map(summarize).join(', ')}]`;
  if (Object.getPrototypeOf(value) !== Object.prototype) return value.constructor?.name ?? 'object';
  return `{${Object.entries(value).map(([k, v]) => `${k}: ${summarize(v)}`).join(', ')}}`;
}

/**
 * Wraps a protocol session: method calls are logged, everything else passes through untouched.
 * @param {any} session @param {(line:string)=>void} log @param {string} name @returns {any}
 */
export function traced(session, log, name) {
  return new Proxy(session, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      return (/** @type {any[]} */ ...args) => {
        const call = `${name}.${prop}(${args.filter(a => typeof a !== 'function').map(summarize).join(', ')})`;
        const start = Date.now();
        log(`→ ${call}`);
        const done = (/** @type {any} */ result) => { log(`← ${call} = ${summarize(result)} (${Date.now() - start} ms)`); return result; };
        const fail = (/** @type {any} */ error) => { log(`✗ ${call} threw ${error?.name ?? 'Error'}: ${error?.message ?? error} (${Date.now() - start} ms)`); throw error; };
        try {
          const result = value.apply(target, args);
          return result instanceof Promise ? result.then(done, fail) : done(result);
        } catch (error) { return fail(error); }
      };
    },
  });
}
