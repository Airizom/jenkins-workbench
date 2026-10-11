export const CHILDREN_CACHE_MAX_ENTRIES = 200;
export const ARTIFACT_CACHE_MAX_ENTRIES = 200;
export const ENVIRONMENT_SUMMARY_CACHE_MAX_ENTRIES = 100;
// Load history outlives cache entries so refreshes keep expanded nodes; bound it separately.
export const LOADED_CHILDREN_KEYS_MAX_ENTRIES = 2_000;

export const CHILDREN_CACHE_TTL_MS = 30_000;
export const ARTIFACT_CACHE_TTL_MS = 5 * 60_000;
export const ENVIRONMENT_SUMMARY_TTL_MS = 60_000;
export const CHILDREN_LOAD_TIMEOUT_MS = 35_000;
export const PINNED_ITEM_LOOKUP_CONCURRENCY = 4;
