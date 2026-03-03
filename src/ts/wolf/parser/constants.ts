/** Wolf RPG Editor binary format protocol markers and validation constants */

// Map event structure markers
export const EVENT_START_MARKER = 111;
export const EVENT_SENTINEL = 12345;
export const EVENT_END_MARKER = 112;
export const PAGE_START_MARKER = 121;
export const PAGE_END_MARKER = 122;

// Common event structure markers
export const COMMON_EVENT_START = 142;
export const COMMON_EVENT_SECTION_A = 143;
export const COMMON_EVENT_SECTION_B = 144;
export const COMMON_EVENT_SECTION_C = 145;
export const COMMON_EVENT_SECTION_D = 146;

// Data validation limits
export const COMMON_EVENT_MAGIC = 2000000;
export const MAX_STRUCTURE_BYTES = 65536;

// Pattern-based parser validation thresholds
export const MAX_ARG_COUNT = 300;
export const MAX_COMMAND_ID = 1000;

// Variable name array size in readCpo
export const CPO_VAR_NAMES_COUNT = 100;
