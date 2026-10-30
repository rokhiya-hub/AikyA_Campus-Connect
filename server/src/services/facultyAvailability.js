const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIME_ZONE = "Asia/Kolkata";
const DEFAULT_WINDOW = { start: "09:00", end: "17:00" }; // Existing application policy, not an official campus timetable.
const get = (value, key) => value instanceof Map ? value.get(key) : value?.[key];
const has = (value, key) => value instanceof Map ? value.has(key) : Object.prototype.hasOwnProperty.call(value || {}, key);
function minutes(value) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
function display(value) {
  const number = minutes(value), hour = Math.floor(number / 60);
  return `${hour % 12 || 12}:${String(number % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}
function windowsFor(record, day) {
  return has(record.teachingWindows, day) ? get(record.teachingWindows, day) : day === "Sunday" ? [] : [{ ...DEFAULT_WINDOW }];
}
function validIntervals(intervals) {
  if (!Array.isArray(intervals)) return false;
  const sorted = [...intervals].sort((a, b) => String(a?.start).localeCompare(String(b?.start)));
  return sorted.every((slot, index) => minutes(slot?.start) !== null && minutes(slot?.end) !== null && slot.start < slot.end && (!index || sorted[index - 1].end <= slot.start));
}
function dayErrors(record, day) {
  const windows = windowsFor(record, day);
  const busy = get(record.timetable, day) || [];
  if (!validIntervals(windows)) return [`${day}: teaching windows must use HH:MM, have positive lengths and not overlap`];
  if (!validIntervals(busy)) return [`${day}: teaching periods must use HH:MM, have positive lengths and not overlap`];
  if (busy.some((slot) => !windows.some((window) => slot.start >= window.start && slot.end <= window.end))) return [`${day}: teaching period is outside its teaching windows`];
  return [];
}
function scheduleErrors(record) {
  const errors = [];
  for (const property of ["timetable", "teachingWindows"]) {
    const keys = record[property] instanceof Map ? [...record[property].keys()] : Object.keys(record[property] || {});
    if (keys.some((day) => !DAYS.includes(day))) errors.push("Unknown weekday");
  }
  for (const day of DAYS) errors.push(...dayErrors(record, day));
  return errors;
}
function dayAvailability(record, day) {
  if (record.onLeave === true) return { status: "on_leave", freePeriods: [], freeTime: [] };
  if (dayErrors(record, day).length) return { status: "invalid", freePeriods: [], freeTime: [] };
  if (!has(record.timetable, day)) return { status: "unknown", freePeriods: [], freeTime: [] };
  const busy = [...(get(record.timetable, day) || [])].sort((a, b) => a.start.localeCompare(b.start));
  const windows = windowsFor(record, day);
  const freePeriods = [];
  for (const window of windows) {
    let cursor = window.start;
    for (const slot of busy.filter((slot) => slot.start >= window.start && slot.end <= window.end)) {
      if (cursor < slot.start) freePeriods.push({ start: cursor, end: slot.start });
      cursor = slot.end;
    }
    if (cursor < window.end) freePeriods.push({ start: cursor, end: window.end });
  }
  return { status: windows.length ? "scheduled" : "non_teaching", freePeriods, freeTime: freePeriods.map((slot) => `${display(slot.start)} - ${display(slot.end)}`) };
}
function availabilityFor(record, now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (name) => parts.find((entry) => entry.type === name).value;
  const day = part("weekday"), time = `${part("hour")}:${part("minute")}`;
  const byDay = Object.fromEntries(DAYS.map((weekday) => [weekday, dayAvailability(record, weekday)]));
  const current = byDay[day];
  let currentStatus = current.status;
  if (current.status === "scheduled") {
    const inside = windowsFor(record, day).some((window) => time >= window.start && time < window.end);
    currentStatus = !inside ? "outside_teaching_window" : current.freePeriods.some((slot) => time >= slot.start && time < slot.end) ? "free_in_timetable" : "teaching";
  }
  const sourceTime = record.timetableUpdatedAt ? new Date(record.timetableUpdatedAt) : null;
  const hasWindows = record.teachingWindows instanceof Map ? record.teachingWindows.size > 0 : Object.keys(record.teachingWindows || {}).length > 0;
  return { timeZone: TIME_ZONE, calculatedAt: date.toISOString(), sourceUpdatedAt: sourceTime && Number.isFinite(sourceTime.getTime()) ? sourceTime.toISOString() : null,
    presence: "not_tracked", teachingWindowSource: hasWindows ? "configured" : "application_default",
    day, currentStatus, byDay };
}
function weeklyLabels(record) {
  return DAYS.flatMap((day) => dayAvailability(record, day).freeTime.map((slot) => `${day}: ${slot}`));
}
module.exports = { DAYS, TIME_ZONE, minutes, windowsFor, scheduleErrors, dayAvailability, availabilityFor, weeklyLabels };
