"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRecord = isRecord;
exports.isString = isString;
exports.isNumber = isNumber;
exports.isBoolean = isBoolean;
exports.isAlertPayload = isAlertPayload;
exports.getString = getString;
exports.getNumber = getNumber;
exports.getBoolean = getBoolean;
/** Check if value is a non-null object */
function isRecord(val) {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
}
/** Check if value is a string */
function isString(val) {
    return typeof val === 'string';
}
/** Check if value is a number */
function isNumber(val) {
    return typeof val === 'number' && !isNaN(val);
}
/** Check if value is a boolean */
function isBoolean(val) {
    return typeof val === 'boolean';
}
/** Check if value is an AlertPayload shape */
function isAlertPayload(val) {
    return isRecord(val) && isString(val.icon) && isString(val.message);
}
/** Safely get a string property from an unknown record */
function getString(obj, key, fallback = '') {
    const val = obj[key];
    return typeof val === 'string' ? val : fallback;
}
/** Safely get a number property from an unknown record */
function getNumber(obj, key, fallback = 0) {
    const val = obj[key];
    return typeof val === 'number' && !isNaN(val) ? val : fallback;
}
/** Safely get a boolean property from an unknown record */
function getBoolean(obj, key, fallback = false) {
    const val = obj[key];
    return typeof val === 'boolean' ? val : fallback;
}
