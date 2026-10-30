export function campusTimestamp(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}
export function verifiedEvent(event) {
  return event?.verification?.status === "verified" && !!event.verification.source?.trim() && new Date(event.verification.verifiedAt).getTime() <= Date.now() && !!event.startsAt && Number.isFinite(new Date(event.startsAt).getTime());
}
export function upcomingEvents(events, now = Date.now()) {
  return events.filter(event => verifiedEvent(event) && new Date(event.endsAt || event.startsAt).getTime() >= now).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}
// datetime-local controls are explicitly campus wall time, independent of device zone.
export const campusInput = value => value ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T") : "";
export const campusISO = value => value ? new Date(`${value}:00+05:30`).toISOString() : null;
