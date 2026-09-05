/** Check if value is a non-null object */
export function isRecord(val: unknown): val is Record<string, unknown> {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/** Check if value is a string */
export function isString(val: unknown): val is string {
    return typeof val === 'string';
}

/** Check if value is a number */
export function isNumber(val: unknown): val is number {
    return typeof val === 'number' && !isNaN(val);
}

/** Check if value is a boolean */
export function isBoolean(val: unknown): val is boolean {
    return typeof val === 'boolean';
}
