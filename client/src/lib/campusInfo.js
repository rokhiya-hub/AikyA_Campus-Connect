export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const CAMPUS_TIME_ZONE = "Asia/Kolkata";
export function campusDate(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: CAMPUS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function campusDay(now = new Date()) { return new Intl.DateTimeFormat("en-GB", { timeZone: CAMPUS_TIME_ZONE, weekday: "long" }).format(now); }
const normalize = (value = "") => String(value).trim().replace(/\s+/g, " ").toLowerCase();
export function findBuilding(record, pois) {
  if (record?.type === "block") return record;
  const buildings = pois.filter((poi) => poi.type === "block");
  if (record?.buildingId) return buildings.find((poi) => String(poi._id) === String(record.buildingId)) || null;
  const label = normalize(record?.block);
  const candidates = label ? buildings.filter((poi) => [poi.name, poi.block].some((name) => normalize(name) === label)) : [];
  return candidates.length === 1 ? candidates[0] : null;
}
export function mapLink(record, pois = []) {
  const building = findBuilding(record, pois);
  const id = record?.type && record._id ? record._id : building?._id || record?.buildingId;
  return id ? `/map?poi=${encodeURIComponent(id)}` : "/map";
}
export function matchesFaculty(faculty, query) {
  const words = normalize(query).split(" ").filter(Boolean);
  const text = normalize([faculty.name, faculty.departmentName, faculty.cabin, faculty.block, faculty.designation].filter(Boolean).join(" "));
  return words.every((word) => text.includes(word));
}
export function floorKey(value) {
  const text = normalize(value);
  if (!text) return "";
  if (text.includes("ground")) return "0";
  return /^(\d+)(?:st|nd|rd|th)?(?:\s*floor)?$/.exec(text)?.[1] || text;
}
export function roomGroups(pois, departments, faculty) {
  return pois.filter((poi) => poi.type === "block").map((building) => {
    const records = [
      ...departments.filter((department) => findBuilding(department, pois)?._id === building._id).flatMap((department) => (department.labs || []).filter((name) => name?.trim()).map((name) => ({ name, floor: department.floor, kind: "Lab", context: department.name }))),
      ...faculty.filter((person) => person.cabin && findBuilding(person, pois)?._id === building._id).map((person) => ({ name: person.cabin, floor: person.floor, kind: "Faculty cabin", context: person.name })),
    ];
    return { building, records };
  }).filter((group) => group.records.length);
}
export function isVerified(value) { return value?.status === "verified" && Boolean(value.source?.trim()) && Number.isFinite(new Date(value.verifiedAt).getTime()) && new Date(value.verifiedAt).getTime() <= Date.now(); }
export function availabilityLabel(person) {
  if (person.onLeave || person.availability?.currentStatus === "on_leave") return "On leave";
  return ({ free_in_timetable: "Free in timetable", teaching: "Teaching period", outside_teaching_window: "Outside teaching window", non_teaching: "No teaching window", invalid: "Timetable needs review" })[person.availability?.currentStatus] || "Timetable unknown";
}
export function isFreshAvailability(person, now = Date.now()) {
  const age = now - new Date(person.availability?.calculatedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= 2 * 60 * 1000;
}
export function hasCoordinates(point) {
  return typeof point?.latitude === "number" && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
    typeof point?.longitude === "number" && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}
