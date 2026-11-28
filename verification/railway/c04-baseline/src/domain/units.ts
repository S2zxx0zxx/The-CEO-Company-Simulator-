// Railway canonical quantities. Decimal strings are the JSON money/energy boundary.
export const MAX_INTEGER = Number.MAX_SAFE_INTEGER;
export const MAX_DECIMAL = 10n ** 30n - 1n;
declare const brand: unique symbol;
export type Unit<K extends string> = number & { readonly [brand]: K };
export type Decimal<K extends string> = string & { readonly [brand]: K };
export type MinorUnits = Decimal<'INR-paise'>;
export type SignedMinorUnits = Decimal<'signed-INR-paise'>;
export type Rounding = 'floor' | 'ceil' | 'toward-zero';
export function integer(value: unknown, path = 'integer', min = 0, max = MAX_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) throw new RangeError(path + ': invalid or overflowing integer');
  return value;
}
export function quantity<K extends string>(kind: K, min = 0, max = MAX_INTEGER) {
  return (value: unknown, path: string = kind): Unit<K> => integer(value, path, min, max) as Unit<K>;
}
export const metres = quantity('m');
export const seconds = quantity('s');
export const kilograms = quantity('kg');
export const seats = quantity('seats');
export const speedKmh = quantity('km/h', 1);
export const gaugeMm = quantity('mm', 1);
export const volts = quantity('V', 1);
export const hertz = quantity('Hz'); // zero is DC; unknown is null, not zero
export const basisPoints = quantity('bps', 0, 10000);
export function decimal<K extends string>(kind: K, signed = false) {
  return (value: unknown, path: string = kind): Decimal<K> => {
    const pattern = signed ? /^(?:0|-?[1-9][0-9]{0,29})$/ : /^(?:0|[1-9][0-9]{0,29})$/;
    if (typeof value !== 'string' || value.trim() !== value || !pattern.test(value)) throw new RangeError(path + ': invalid canonical decimal or overflow');
    return value as Decimal<K>;
  };
}
export const minor = decimal('INR-paise');
export const signedMinor = decimal('signed-INR-paise', true);
export const energyQuantity = decimal('energy-quantity');
export function checkedAdd(a: number, b: number): number {
  return integer(integer(a) + integer(b));
}
export function addMinor(a: MinorUnits, b: MinorUnits): MinorUnits {
  return minor(String(BigInt(minor(a)) + BigInt(minor(b))));
}
export function subtractMinor(a: MinorUnits, b: MinorUnits): MinorUnits {
  return minor(String(BigInt(minor(a)) - BigInt(minor(b))));
}
// Exact integer rational scaling, with an explicit policy even for negative values.
export function roundRatio(value: bigint, numerator: bigint, denominator: bigint, rounding: Rounding): bigint {
  if (typeof value !== 'bigint' || typeof numerator !== 'bigint' || typeof denominator !== 'bigint' || denominator <= 0n || numerator < 0n || !['floor','ceil','toward-zero'].includes(rounding)) throw new RangeError('Invalid rational rate');
  if (value < -MAX_DECIMAL || value > MAX_DECIMAL || numerator > MAX_DECIMAL || denominator > MAX_DECIMAL) throw new RangeError('Rational input overflow');
  const product = value * numerator;
  let out = product / denominator;
  if (product % denominator !== 0n) {
    if (rounding === 'floor' && product < 0n) out--;
    if (rounding === 'ceil' && product > 0n) out++;
  }
  if (out < -MAX_DECIMAL || out > MAX_DECIMAL) throw new RangeError('Rational result overflow');
  return out;
}
export function scaleMinor(value: MinorUnits, numerator: bigint, denominator: bigint, rounding: Rounding): MinorUnits {
  return minor(String(roundRatio(BigInt(minor(value)), numerator, denominator, rounding)));
}
export function metresAtSpeed(speed: Unit<'km/h'>, duration: Unit<'s'>, rounding: Rounding): Unit<'m'> {
  // km/h * seconds * 5/18 = metres, without binary floating arithmetic.
  return metres(Number(roundRatio(BigInt(speedKmh(speed)) * BigInt(seconds(duration)), 5n, 18n, rounding)));
}
export function secondsForDistance(distance: Unit<'m'>, speed: Unit<'km/h'>, rounding: Rounding): Unit<'s'> {
  return seconds(Number(roundRatio(BigInt(metres(distance)), 18n, BigInt(speedKmh(speed)) * 5n, rounding)));
}
