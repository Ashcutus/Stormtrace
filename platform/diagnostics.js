// Fixed numeric schema: never retain request bodies, URLs, messages or configuration.
export const fields = ['uptimeMs','lagMs','hidden','paused','markers','markerPeak','strikes','pendingWrites','received','processed','connections','reconnects','networkFailures','errors','radarAttempts','radarSuccesses','radarFailures','radarDurationMs','lightningAgeMs','radarAgeMs','radarSourceAgeMs'];
export function sanitizeDiagnostics(value) {
  const result = {};
  for (const key of fields) if (Number.isFinite(value?.[key]) && value[key] >= 0) result[key] = Math.min(value[key], Number.MAX_SAFE_INTEGER);
  return result;
}
