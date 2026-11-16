/**
 * URL the browser should load a result file from. Aholo results go through the same-origin proxy
 * (CORS + host allowlist); files bundled with the app (the recorded demo in /public/demo) load directly.
 */
export const assetUrl = (url: string): string =>
  url.startsWith("/") ? url : `/api/aholo/asset?url=${encodeURIComponent(url)}`;
