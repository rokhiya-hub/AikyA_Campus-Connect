const { serialize, fields } = require("./publicData");
const {
  safeText,
  sensitiveQuestion,
  MAX_FACTS,
  MAX_CONTEXT_BYTES,
  bounded,
} = require("./chatPolicy");
const MODELS = {
  Department: require("../models/Department"),
  Faculty: require("../models/Faculty"),
  PointOfInterest: require("../models/PointOfInterest"),
  BusRoute: require("../models/BusRoute"),
  Event: require("../models/Event"),
};
const GROUPS = {
  faculty: [
    "faculty",
    "teacher",
    "professor",
    "lecturer",
    "cabin",
    "prof",
    "mentor",
  ],
  food: [
    "food",
    "eat",
    "canteen",
    "shop",
    "menu",
    "price",
    "stock",
    "tea",
    "coffee",
    "xerox",
    "photocopy",
    "stationery",
    "notebook",
    "printing",
    "snack",
  ],
  hostel: ["hostel", "warden", "dorm", "vacancy", "vacant", "accommodation"],
  transport: ["bus", "buses", "route", "transport", "shuttle", "driver"],
  departments: [
    "department",
    "dept",
    "cse",
    "ece",
    "eee",
    "mechanical",
    "civil",
    "labs",
    "hod",
  ],
  library: ["library", "libraries", "reading"],
  office: [
    "office",
    "admission",
    "fee",
    "medical",
    "bank",
    "placement",
    "accounts",
  ],
  events: ["event", "events", "hackathon", "fest", "workshop", "seminar"],
  places: ["where", "location", "building", "block", "directions"],
  access: ["allowed", "restriction", "policy", "access"],
};
const tokenize = (value) =>
  String(value)
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
const STOP = new Set([
  "where",
  "what",
  "when",
  "who",
  "how",
  "is",
  "are",
  "the",
  "a",
  "an",
  "at",
  "in",
  "on",
  "of",
  "to",
  "for",
  "please",
  "find",
  "tell",
  "me",
  "about",
  "my",
  "can",
  "you",
  "any",
  "all",
  "list",
  "show",
  "today",
  "now",
  "available",
  "availability",
  "presence",
  "present",
  "open",
  "hours",
  "timings",
  "free",
  "room",
  "campus",
  ...Object.values(GROUPS).flat(),
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);
[
  "cse",
  "ece",
  "eee",
  "mechanical",
  "civil",
  "xerox",
  "photocopy",
  "stationery",
  "notebook",
  "printing",
  "tea",
  "coffee",
  "admission",
  "medical",
  "bank",
  "placement",
  "fee",
  "accounts",
].forEach((term) => STOP.delete(term));
function detectIntents(question) {
  const tokens = new Set(tokenize(question));
  return Object.entries(GROUPS)
    .filter(([, words]) => words.some((word) => tokens.has(word)))
    .map(([name]) => name);
}
const SEARCH = {
  Department: ["name", "code", "block"],
  Faculty: ["name", "departmentName", "block", "cabin"],
  PointOfInterest: ["name", "block", "area", "items.name"],
  BusRoute: ["routeNumber", "routeDescription", "stops.name"],
  Event: ["title", "venue", "department"],
};
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function publicCollection(Model, { filter = {}, limit = 8 } = {}) {
  const projection = [
    ...fields[Model.modelName],
    ...(Model.modelName === "Faculty"
      ? ["timetable", "teachingWindows", "timetableUpdatedAt"]
      : []),
    ...(Model.modelName === "PointOfInterest"
      ? ["category", "shopVerification", "openingSchedule"]
      : []),
  ].filter(
    (field) =>
      ![
        "email",
        "driverName",
        "driverContact",
        "contact",
        "warden",
        "totalRooms",
        "vacantRooms",
      ].includes(field),
  );
  const records = await Model.find(filter)
    .select(projection.join(" "))
    .sort({ _id: 1 })
    .limit(Math.min(8, limit))
    .maxTimeMS(1200)
    .lean();
  const output = [];
  for (const record of records) {
    try {
      const result = serialize(Model.modelName, record);
      for (const key of [
        "email",
        "passwordHash",
        "timetable",
        "teachingWindows",
        "driverName",
        "driverContact",
        "contact",
        "warden",
        "totalRooms",
        "vacantRooms",
      ])
        delete result[key];
      output.push(result);
    } catch {
      /* Corrupt records are omitted, never inserted into a provider prompt. */
    }
  }
  return output;
}
function collectionsFor(intents) {
  const result = new Set();
  if (intents.includes("faculty")) result.add("Faculty");
  if (intents.includes("transport")) result.add("BusRoute");
  if (intents.includes("events")) result.add("Event");
  if (intents.includes("departments") && !intents.includes("faculty"))
    result.add("Department");
  if (
    intents.some((name) =>
      ["food", "hostel", "library", "office", "access"].includes(name),
    )
  )
    result.add("PointOfInterest");
  if (!result.size && intents.includes("places")) {
    result.add("PointOfInterest");
    result.add("Department");
  }
  return result.size ? [...result] : Object.keys(MODELS);
}
function sourceFor(type, record) {
  const recordId = String(record._id || "");
  const label = safeText(
    type === "BusRoute"
      ? `Route ${record.routeNumber}`
      : record.name || record.title,
    120,
  );
  if (!/^[a-f0-9]{24}$/.test(recordId) || !label) return null;
  const path =
    type === "Faculty"
      ? "/faculty"
      : type === "Department"
        ? "/departments"
        : type === "BusRoute"
          ? "/buses"
          : type === "Event"
            ? "/events"
            : record.type === "shop"
              ? "/canteen"
              : record.type === "hostel"
                ? "/hostels"
                : `/map?poi=${recordId}`;
  return { id: `${type}:${recordId}`, recordId, type, label, path };
}
function recordFacts(type, record, source, question) {
  const facts = [];
  function add(key, value, prefix = "Recorded", personal = false) {
    const text = safeText(value, 420);
    if (!text) return;
    const rendered = `${prefix}: ${text}`;
    facts.push({
      id: `${source.id}:${key}`,
      sourceId: source.id,
      label: source.label,
      text: rendered,
      externalAllowed:
        !personal &&
        !["Faculty"].includes(type) &&
        !(type === "PointOfInterest" && record.type === "hostel") &&
        !sensitiveQuestion(`${source.label} ${rendered}`),
    });
  }
  const location = [
    record.block,
    record.floor,
    type === "Faculty" ? record.cabin : null,
  ]
    .map((value) => safeText(value, 100))
    .filter(Boolean)
    .join(", ");
  add(
    "location",
    location,
    "Recorded location (unverified unless officially confirmed)",
    type === "Faculty",
  );
  if (type === "Faculty") {
    add("department", record.departmentName, "Department", true);
    add("designation", record.designation, "Directory designation", true);
    const days = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];
    const day =
      days.find((day) => tokenize(question).includes(day.toLowerCase())) ||
      record.availability?.day;
    const availability = record.availability?.byDay?.[day];
    if (availability)
      add(
        "timetable",
        `${day}: ${(availability.freeTime || []).slice(0, 5).join(", ") || "No published timetable gap"}. Calculated ${record.availability.calculatedAt}. Physical presence is not tracked.`,
        "Timetable only",
        true,
      );
  } else if (type === "Department") {
    add("code", record.code, "Department code");
    add(
      "hours",
      record.officeHours,
      "Recorded office hours (not live or independently verified)",
    );
    add(
      "labs",
      (record.labs || [])
        .slice(0, 5)
        .map((value) => safeText(value, 80))
        .filter(Boolean)
        .join(", "),
      "Recorded labs",
    );
  } else if (type === "BusRoute") {
    add(
      "schedule",
      [
        record.departureTime && `Departs ${record.departureTime}`,
        record.returnTime && `Returns ${record.returnTime}`,
      ]
        .filter(Boolean)
        .join("; "),
      "Recorded schedule; not live tracking",
    );
    add(
      "stops",
      (record.stops || [])
        .slice(0, 6)
        .map((stop) =>
          [safeText(stop.name, 60), safeText(stop.time, 30)]
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean)
        .join("; "),
      "Scheduled stops; not an ETA",
    );
  } else if (type === "Event") {
    add(
      "event",
      [record.date, record.startTime, record.endTime, record.venue]
        .map((value) => safeText(value, 100))
        .filter(Boolean)
        .join("; "),
      "Recorded event schedule (confirm changes)",
    );
  } else {
    add("type", record.type, "Place category");
    add(
      "hours",
      record.openHours,
      "Recorded hours (not verified open/closed status)",
    );
    if (record.type === "shop") {
      const query = tokenize(question);
      const items = [...(record.items || [])]
        .sort(
          (a, b) =>
            tokenize(b.name).filter((token) => query.includes(token)).length -
            tokenize(a.name).filter((token) => query.includes(token)).length,
        )
        .slice(0, 3);
      for (const [index, item] of items.entries()) {
        const name = safeText(item.name, 80);
        if (!name) continue;
        const price = safeText(item.price, 80);
        const fresh =
          item.stock?.confirmation === "recent_report" &&
          new Date(item.stock.expiresAt) > new Date();
        add(
          `item${index}`,
          `${name}${price ? `; recorded price ${price}` : "; price unavailable"}; ${fresh ? `reported ${item.stock.reportedStatus}` : "availability unconfirmed"}; price updated ${item.pricing?.lastUpdatedAt || "unknown"}; stock updated ${item.stock?.lastUpdatedAt || "unknown"}. ${record.dataStatus === "verified_listing" ? "Listing verified" : "Demo / unverified listing"}; confirm price and stock with shop.`,
          "Listing report",
        );
      }
    }
  }
  if (!facts.length)
    add(
      "directory",
      source.label,
      "Directory record only; further details unavailable",
      type === "Faculty",
    );
  return facts;
}
function createCampusDataService({ models = MODELS } = {}) {
  async function retrieveCampusContext(question, { signal } = {}) {
    const intents = detectIntents(question),
      terms = [
        ...new Set(
          tokenize(question).filter(
            (token) => !STOP.has(token) && token.length > 1,
          ),
        ),
      ].slice(0, 6);
    const names = collectionsFor(intents);
    const fetched = await bounded(
      () =>
        Promise.all(
          names.map(async (name) => {
            const filter = {};
            if (name === "PointOfInterest") {
              const types = [
                ...new Set([
                  ...(intents.includes("food") ? ["shop"] : []),
                  ...(intents.includes("hostel") ? ["hostel"] : []),
                  ...(intents.includes("library") ? ["library"] : []),
                  ...(intents.includes("office") ? ["office", "service"] : []),
                ]),
              ];
              if (types.length === 1) filter.type = types[0];
              else if (types.length)
                filter.$and = [{ $or: types.map((type) => ({ type })) }];
            }
            if (terms.length)
              filter.$or = terms.flatMap((term) =>
                SEARCH[name].map((field) => ({
                  [field]: { $regex: escaped(term), $options: "i" },
                })),
              );
            // Unknown questions never trigger an unfiltered complete snapshot.
            if (!terms.length && !intents.length) return [];
            return (
              await publicCollection(models[name], { filter, limit: 8 })
            ).map((record) => ({ type: name, record }));
          }),
        ),
      2500,
      signal,
      "RETRIEVAL_TIMEOUT",
    );
    const ranked = fetched
      .flat()
      .map(({ type, record }) => {
        const source = sourceFor(type, record);
        if (!source) return null;
        const haystack = tokenize(
          [
            source.label,
            record.departmentName,
            record.block,
            record.cabin,
            ...(record.items || []).map((item) => item.name),
          ]
            .filter(Boolean)
            .join(" "),
        );
        const score = terms.filter((term) =>
          haystack.some((token) => token.startsWith(term)),
        ).length;
        const exact =
          source.label.length > 2 &&
          question.toLowerCase().includes(source.label.toLowerCase());
        try {
          return {
            type,
            record,
            source,
            score: score + (exact ? 100 : 0),
            facts: recordFacts(type, record, source, question),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((item) => !terms.length || item.score > 0)
      .sort(
        (a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id),
      );
    const best = ranked[0]?.score;
    const candidates = ranked.filter((item) => item.score === best).slice(0, 8);
    const clarification =
      candidates.length > 1 &&
      !/\b(?:list|all|options|compare|any|events)\b/i.test(question);
    const chosen = clarification
      ? candidates
      : best >= 100
        ? candidates
        : ranked.slice(0, 4);
    const context = { facts: [], sources: [], clarification, notices: [] };
    if (
      /\b(?:present|presence|vacancy|vacant|live|right now)\b/i.test(
        question,
      ) ||
      (intents.includes("transport") && /\bnow\b/i.test(question))
    )
      context.notices.push(
        "Physical presence, private vacancy and live bus positions are not available through this assistant. Use the relevant directory or authorized Bus Live Tracking when enabled.",
      );
    for (const item of chosen) {
      if (context.facts.length >= MAX_FACTS) break;
      context.sources.push(item.source);
      for (const fact of item.facts) {
        if (context.facts.length >= MAX_FACTS) break;
        context.facts.push(fact);
        if (Buffer.byteLength(JSON.stringify(context)) > MAX_CONTEXT_BYTES) {
          context.facts.pop();
          break;
        }
      }
      if (!context.facts.some((fact) => fact.sourceId === item.source.id))
        context.sources.pop();
    }
    const requested = /\b(price|cost|fee)\b/i.test(question)
      ? "item"
      : /\b(timing|timings|hours)\b/i.test(question)
        ? "hours"
        : null;
    if (
      requested &&
      !context.facts.some((fact) => fact.id.includes(`:${requested}`))
    )
      context.notices.push(
        "The requested price or timing information is not currently available in the retrieved records.",
      );
    return { intents, context };
  }
  return { retrieveCampusContext };
}
module.exports = {
  ...createCampusDataService(),
  createCampusDataService,
  detectIntents,
  publicCollection,
};
