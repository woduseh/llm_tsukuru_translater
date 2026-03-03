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

/** Check if value is an AlertPayload shape */
export function isAlertPayload(val: unknown): val is { icon: string; message: string } {
    return isRecord(val) && isString(val.icon) && isString(val.message);
}

/** Safely get a string property from an unknown record */
export function getString(obj: Record<string, unknown>, key: string, fallback = ''): string {
    const val = obj[key];
    return typeof val === 'string' ? val : fallback;
}

/** Safely get a number property from an unknown record */
export function getNumber(obj: Record<string, unknown>, key: string, fallback = 0): number {
    const val = obj[key];
    return typeof val === 'number' && !isNaN(val) ? val : fallback;
}

/** Safely get a boolean property from an unknown record */
export function getBoolean(obj: Record<string, unknown>, key: string, fallback = false): boolean {
    const val = obj[key];
    return typeof val === 'boolean' ? val : fallback;
}
