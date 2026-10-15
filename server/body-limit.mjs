// Body limit for the JSON API, kept small enough to reason about and large enough for a real plan.
// A plan carries one target per account, and the panel allows up to 100 accounts with 20 Instagram
// links each: roughly 100 x (20 x 93 + 60) bytes, about 200 KB. A 32 KB cap rejected a plan the
// panel itself built, and the API answered 500 "request entity too large" instead of starting.
export const JSON_BODY_LIMIT = '2mb';
export const JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
