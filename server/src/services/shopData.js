const TIME_ZONE = "Asia/Kolkata";
const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const SHOP_CATEGORIES = [
  "food",
  "stationery",
  "printing",
  "grocery",
  "services",
  "other",
  "unclassified",
];
const ITEM_CATEGORIES = [
  "food",
  "beverage",
  "stationery",
  "printing",
  "service",
  "other",
  "unclassified",
];
const STOCK_TTL = 2 * 60 * 60 * 1000;
const PRICE_TTL = 7 * 24 * 60 * 60 * 1000;
function words(value) {
  const synonyms = {
    photocopy: "xerox",
    photocopies: "xerox",
    photocopying: "xerox",
    stationary: "stationery",
    colour: "color",
  };
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => synonyms[word] || word);
}
function itemTokens(item) {
  return [
    ...new Set(
      words([item.name, item.category, ...(item.keywords || [])].join(" ")),
    ),
  ];
}
function matchesItem(item, query = "", category) {
  if (
    item.active === false ||
    (category && (item.category || "unclassified") !== category)
  )
    return false;
  const tokens = itemTokens(item);
  return words(query).every((word) =>
    tokens.some((token) => token.startsWith(word)),
  );
}
function timeMinutes(value, end = false) {
  if (end && value === "24:00") return 1440;
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
function periodErrors(periods) {
  if (!Array.isArray(periods)) return true;
  const sorted = [...periods].sort((a, b) =>
    String(a.start).localeCompare(String(b.start)),
  );
  return sorted.some(
    (period, index) =>
      timeMinutes(period.start) === null ||
      timeMinutes(period.end, true) === null ||
      timeMinutes(period.start) >= timeMinutes(period.end, true) ||
      (index > 0 &&
        timeMinutes(sorted[index - 1].end, true) > timeMinutes(period.start)),
  );
}
const get = (value, key) =>
  value instanceof Map ? value.get(key) : value?.[key];
const has = (value, key) =>
  value instanceof Map
    ? value.has(key)
    : Object.prototype.hasOwnProperty.call(value || {}, key);
function scheduleError(schedule) {
  if (!schedule) return null;
  if (schedule.timeZone !== TIME_ZONE)
    return "Shop timezone must be Asia/Kolkata";
  const keys =
    schedule.weekly instanceof Map
      ? [...schedule.weekly.keys()]
      : Object.keys(schedule.weekly || {});
  if (
    keys.some((day) => !DAYS.includes(day)) ||
    keys.some((day) => periodErrors(get(schedule.weekly, day)))
  )
    return "Invalid or overlapping weekly opening periods";
  for (const field of ["holidays", "exceptions"]) {
    const entries = schedule[field] || [];
    if (new Set(entries.map((entry) => entry.date)).size !== entries.length)
      return "Duplicate schedule dates";
    for (const entry of entries)
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
        !Number.isFinite(Date.parse(entry.date)) ||
        new Date(entry.date).toISOString().slice(0, 10) !== entry.date ||
        periodErrors(entry.periods || [])
      )
        return "Invalid date or overlapping dated opening periods";
  }
  return null;
}
function openingStatus(shop, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (name) => parts.find((entry) => entry.type === name).value;
  const date = `${part("year")}-${part("month")}-${part("day")}`,
    weekday = part("weekday"),
    minute = Number(part("hour")) * 60 + Number(part("minute"));
  const result = {
    state: "unknown",
    source: "legacy",
    timeZone: TIME_ZONE,
    date,
    weekday,
    periods: [],
    calculatedAt: now.toISOString(),
  };
  const schedule = shop.openingSchedule;
  if (!schedule || scheduleError(schedule)) return result;
  const exception = (schedule.exceptions || []).find(
    (entry) => entry.date === date,
  );
  const holiday = (schedule.holidays || []).find(
    (entry) => entry.date === date,
  );
  let periods;
  if (exception) {
    periods = exception.periods;
    result.source = "exception";
  } else if (holiday) {
    periods = holiday.periods || [];
    result.source = "holiday";
  } else if (has(schedule.weekly, weekday)) {
    periods = get(schedule.weekly, weekday);
    result.source = "weekly";
  }
  if (!periods) return result;
  result.periods = periods.map(({ start, end }) => ({ start, end }));
  result.state = periods.some(
    (period) =>
      minute >= timeMinutes(period.start) &&
      minute < timeMinutes(period.end, true),
  )
    ? "scheduled_open"
    : "scheduled_closed";
  return result;
}
function reportMetadata(report, ttl, now) {
  const date = report?.lastUpdatedAt ? new Date(report.lastUpdatedAt) : null;
  const valid =
    date && Number.isFinite(date.getTime()) && date.getTime() <= now.getTime();
  return {
    lastUpdatedAt: valid ? date.toISOString() : null,
    updatedBy: report?.updatedBy?.role || null,
    expiresAt: valid ? new Date(date.getTime() + ttl).toISOString() : null,
    stale: !valid || now.getTime() - date.getTime() >= ttl,
  };
}
function publicItem(item, now = new Date()) {
  const stock = reportMetadata(item.stock, STOCK_TTL, now),
    pricing = reportMetadata(item.pricing, PRICE_TTL, now);
  return {
    _id: item._id,
    name: item.name,
    price: item.price,
    available: item.available,
    category: item.category || "unclassified",
    keywords: item.keywords || [],
    active: item.active !== false,
    lastUpdatedAt: item.lastUpdatedAt || null,
    updatedBy: item.updatedBy?.role || null,
    stock: {
      ...stock,
      reportedStatus:
        item.stock?.status ||
        (item.available === false
          ? "out_of_stock"
          : item.available === true
            ? "in_stock"
            : "unknown"),
      confirmation:
        stock.stale || !item.stock?.status || item.stock.status === "unknown"
          ? "unconfirmed"
          : "recent_report",
    },
    pricing,
  };
}
function isVerified(value, now = new Date()) {
  return (
    value?.status === "verified" &&
    typeof value.source === "string" &&
    value.source.trim() &&
    value.verifiedAt &&
    new Date(value.verifiedAt).getTime() <= now.getTime()
  );
}
function shopProjection(shop, now = new Date()) {
  const active = (shop.items || []).filter((item) => item.active !== false);
  return {
    category: shop.category || "unclassified",
    contact: shop.contact || "",
    dataStatus: isVerified(shop.shopVerification, now)
      ? "verified_listing"
      : "demo_unverified",
    shopVerification: isVerified(shop.shopVerification, now)
      ? {
          status: "verified",
          source: shop.shopVerification.source,
          verifiedAt: shop.shopVerification.verifiedAt,
        }
      : { status: "unverified" },
    items: active.map((item) => publicItem(item, now)),
    openingSchedule: shop.openingSchedule || null,
    openingStatus: openingStatus(shop, now),
  };
}
module.exports = {
  TIME_ZONE,
  DAYS,
  SHOP_CATEGORIES,
  ITEM_CATEGORIES,
  STOCK_TTL,
  PRICE_TTL,
  words,
  itemTokens,
  matchesItem,
  scheduleError,
  openingStatus,
  publicItem,
  shopProjection,
};
