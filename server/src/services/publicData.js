const { availabilityFor, weeklyLabels } = require("./facultyAvailability");
// Explicit projections make additions to Mongoose schemas private by default.
const fields = {
  Department: ["name", "code", "block", "buildingId", "locationVerification", "floor", "hod", "labs", "contactEmail", "officeHours"],
  Faculty: ["name", "departmentId", "departmentName", "buildingId", "locationVerification", "designation", "cabin", "block", "floor", "subjects", "onLeave", "availableSlots"],
  PointOfInterest: ["type", "name", "block", "buildingId", "floor", "area", "areaGroup", "latitude", "longitude", "coordinateVerification", "openHours", "isOpenNow", "description", "items", "hostelType", "accessPolicy", "allocation"],
  BusRoute: ["trackingEnabled", "vehicleLabel", "routeNumber", "routeDescription", "stops", "departureTime", "returnTime", "driverName", "driverContact", "busType", "ground", "status"],
  Event: ["title", "description", "date", "startTime", "endTime", "venue", "organizer", "department", "category", "startsAt", "endsAt", "deadlineAt", "timezone", "verification"],
};
function serialize(modelName, document, principal) {
  const source = typeof document.toObject === "function" ? document.toObject({ flattenMaps: true }) : document;
  const allowed = [...fields[modelName], "_id", "createdAt", "updatedAt"];
  const admin = principal?.role === "admin";
  if (modelName === "Faculty" && (admin || (principal?.role === "faculty" && String(principal.sub) === String(source._id)))) allowed.push("email", "timetable", "teachingWindows");
  if (modelName === "PointOfInterest" && admin) allowed.push("warden", "contact", "totalRooms", "vacantRooms");
  const result = Object.fromEntries(allowed.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
  const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
  if (result.items) result.items = result.items.map((item) => pick(item, ["name", "price", "available"]));
  if (modelName === "PointOfInterest" && source.type === "shop") Object.assign(result, require("./shopData").shopProjection(source));
  if (result.stops) result.stops = result.stops.map((stop) => pick(stop, ["name", "time"]));
  if (result.accessPolicy) result.accessPolicy = pick(result.accessPolicy, ["allowedRoles", "restrictedRoles", "startTime", "endTime", "note"]);
  const verification = (value) => value?.status === "verified" && value.source?.trim() && value.verifiedAt && new Date(value.verifiedAt).getTime() <= Date.now()
    ? pick(value, ["status", "source", "verifiedAt"]) : { status: "unverified" };
  if (modelName === "Faculty") {
    result.availability = availabilityFor(source);
    result.availableSlots = weeklyLabels(source);
  }
  if (modelName === "Event") result.verification = verification(source.verification);
  if (["Faculty", "Department"].includes(modelName)) result.locationVerification = verification(source.locationVerification);
  if (modelName === "PointOfInterest") result.coordinateVerification = verification(source.coordinateVerification);
  if (result.allocation) result.allocation = { ...pick(result.allocation, ["institution", "branches", "years", "status"]), verification: verification(source.allocation?.verification) };
  return result;
}
module.exports = { serialize, fields };
