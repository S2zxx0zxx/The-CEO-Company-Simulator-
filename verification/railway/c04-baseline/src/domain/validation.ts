export type Decoder<T> = (value: unknown, path?: string) => T;
export type Decoded<D> = D extends Decoder<infer T> ? T : never;
export function invalid(path: string, reason: string): never { throw new TypeError(path + ': ' + reason); }
export function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return invalid(path, 'expected plain object');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(value, key)!)) invalid(path, 'non-JSON property');
  }
  return value as Record<string, unknown>;
}
export function object<S extends Record<string, Decoder<unknown>>>(shape: S): Decoder<{[K in keyof S]: Decoded<S[K]>}> {
  return (value, path = 'object') => {
    const input = record(value, path);
    for (const key of Object.keys(input)) if (!Object.hasOwn(shape, key)) invalid(path + '.' + key, 'unknown field');
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      if (!Object.hasOwn(input, key)) invalid(path + '.' + key, 'required field missing');
      Object.defineProperty(out, key, { value: shape[key](input[key], path + '.' + key), enumerable: true, writable: true, configurable: true });
    }
    return out as {[K in keyof S]: Decoded<S[K]>};
  };
}
export function text(max: number, pattern?: RegExp): Decoder<string> {
  return (value, path = 'text') => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) && (!pattern || pattern.test(value)) ? value : invalid(path, 'invalid text');
}
export function enumeration<const T extends readonly string[]>(values: T): Decoder<T[number]> {
  return (value, path = 'enum') => typeof value === 'string' && values.includes(value) ? value as T[number] : invalid(path, 'unknown enum');
}
export const booleanValue: Decoder<boolean> = (value, path = 'boolean') => typeof value === 'boolean' ? value : invalid(path, 'expected boolean');
export function nullable<T>(decoder: Decoder<T>): Decoder<T | null> {
  return (value, path) => value === null ? null : decoder(value, path);
}
export function list<T>(decoder: Decoder<T>, min = 0, max = 100000): Decoder<T[]> {
  return (value, path = 'array') => {
    if (!Array.isArray(value) || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return invalid(path, 'invalid array length or sparse array');
    const out: T[] = [];
    for (let i = 0; i < value.length; i++) {
      const prop = Object.getOwnPropertyDescriptor(value, String(i));
      if (!prop || !('value' in prop) || !prop.enumerable) invalid(path, 'invalid array entry');
      out.push(decoder(prop!.value, path + '[' + i + ']'));
    }
    return out;
  };
}
export function refine<T>(decoder: Decoder<T>, check: (value: T) => boolean, reason: string): Decoder<T> {
  return (value, path = 'value') => { const decoded = decoder(value, path); return check(decoded) ? decoded : invalid(path, reason); };
}
export function distinct<T>(decoder: Decoder<T[]>, key: (value: T) => string | number): Decoder<T[]> {
  return refine(decoder, values => new Set(values.map(key)).size === values.length, 'duplicate values');
}
export const id = text(128, /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);
export const sha256 = text(64, /^[a-f0-9]{64}$/);
export const sourceUrl = refine(text(2048), value => {
  try { const url = new URL(value); return (value.startsWith('https://') && url.protocol === 'https:' && !url.username && !url.password) || (url.protocol === 'urn:' && value.startsWith('urn:railway:') && value.length > 'urn:railway:'.length); } catch { return false; }
}, 'expected HTTPS source or original railway URN');
export const utc = refine(text(24, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/), value => {
  const epoch = Date.parse(value); return Number.isFinite(epoch) && new Date(epoch).toISOString() === (value.length === 20 ? value.slice(0, -1) + '.000Z' : value);
}, 'invalid UTC timestamp');
export const coord: Decoder<readonly [number, number]> = (value, path = 'coordinate') => {
  const n = list((v, p = path) => typeof v === 'number' && Number.isFinite(v) ? v : invalid(p, 'invalid coordinate'), 2, 2)(value, path);
  if (n[0] < -180 || n[0] > 180 || n[1] < -90 || n[1] > 90) invalid(path, 'coordinate out of range');
  return [n[0], n[1]];
};
export const version1: Decoder<1> = (value, path = 'schemaVersion') => value === 1 ? 1 : invalid(path, 'unsupported schema version');
// Payloads are decoded by their registered domain schema, never by an unchecked cast.
export type Registry = Readonly<Record<string, Decoder<unknown>>>;
export function registered(registry: Registry, key: string, value: unknown, path: string): unknown {
  if (!Object.hasOwn(registry, key) || typeof registry[key] !== 'function') invalid(path, 'unregistered payload kind');
  return registry[key](value, path);
}
