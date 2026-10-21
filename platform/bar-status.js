// Bar alert state reported by the open window to the local server, so the
// Omarchy bar widget can show it through /api/health. Values are bounded and
// expire on their own: a closed or crashed window cannot leave a stale alert.
export const BAR_ALERT_KINDS = ["lightning", "warning", "flood", "earthquake"];
export const BAR_ALERT_MAX_MS = 15 * 60 * 1000;

export function sanitizeBarStatus(value, now = Date.now()) {
  if (value === null || value?.alert === null) return null;
  const alert = value?.alert;
  if (!alert || typeof alert !== "object" || !BAR_ALERT_KINDS.includes(alert.kind)) throw new TypeError("invalid bar alert");
  const until = Number(alert.until);
  if (!Number.isFinite(until) || until <= now || until > now + BAR_ALERT_MAX_MS) throw new TypeError("invalid bar alert expiry");
  const title = typeof alert.title === "string" ? alert.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 140) : "";
  return { kind: alert.kind, title, until };
}

export function currentBarAlert(alert, now = Date.now()) {
  return alert && alert.until > now ? { kind: alert.kind, title: alert.title } : null;
}
