/** API, translation, and application-wide constants */

// Exponential backoff for API errors
export const API_BACKOFF_BASE_MS = 2000;
export const API_BACKOFF_MAX_MS = 60000;

// Exponential backoff for validation retries
export const VALIDATION_RETRY_BASE_MS = 2000;
export const VALIDATION_RETRY_MAX_MS = 30000;

// Rate limiting between translation chunks
export const RATE_LIMIT_DELAY_MS = 1000;

// Default API timeout (seconds)
export const DEFAULT_API_TIMEOUT_SEC = 600;

// Logger
export const MAX_LOG_FILE_SIZE = 5 * 1024 * 1024; // 5MB
