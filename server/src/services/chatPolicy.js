const { z } = require("zod");
const UNAVAILABLE = "This information is not currently available.";
const MAX_FACTS = 24,
  MAX_CONTEXT_BYTES = 6500,
  MAX_PROMPT_BYTES = 8192;
const suspicious =
  /ignore\s+(?:all\s+|previous\s+|prior\s+|the\s+)*(?:instructions|rules)|system\s*prompt|developer\s*message|(?:system|assistant)\s*:|<\/?(?:system|script)|reveal\s+(?:secrets|keys|tokens)|override\s+(?:instructions|rules)/i;
function safeText(value, max = 240) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ||
    suspicious.test(value)
  )
    return null;
  return value.trim();
}
function sensitiveQuestion(value) {
  return /\b(?:password|secret|token|credential|api.?key|private|personal|phone|email|medical|health|salary|student.?id|roll.?no|warden|faculty|professor|teacher|lecturer|hostel|cabin|gps|latitude|longitude)\b|\bmy\s+(?:name|address|room|location|number|family|id)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\s()-]*){9,}/i.test(
    value,
  );
}
const factSchema = z.strictObject({
  id: z.string().max(120),
  sourceId: z.string().max(80),
  label: z.string().max(120),
  text: z.string().max(700),
  externalAllowed: z.boolean(),
});
const contextSchema = z.strictObject({
  facts: z.array(factSchema).max(MAX_FACTS),
  sources: z
    .array(
      z.strictObject({
        id: z.string().max(80),
        recordId: z.string().regex(/^[a-f0-9]{24}$/),
        type: z.enum([
          "Department",
          "Faculty",
          "PointOfInterest",
          "BusRoute",
          "Event",
        ]),
        label: z.string().max(120),
        path: z.string().regex(/^\/(?:faculty|departments|buses|events|canteen|hostels|map(?:\?poi=[a-f0-9]{24})?)$/),
      }),
    )
    .max(8),
  clarification: z.boolean(),
  notices: z.array(z.string().max(300)).max(5),
});
function validatedContext(value) {
  const context = contextSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(context)) > MAX_CONTEXT_BYTES)
    throw new Error("Context exceeds budget");
  const sources = new Set(context.sources.map((source) => source.id));
  if (sources.size !== context.sources.length || context.sources.some(source => source.id !== `${source.type}:${source.recordId}` || !safeText(source.label, 120)) || (context.clarification && sources.size < 2)) throw new Error("Invalid source");
  if (
    new Set(context.facts.map((fact) => fact.id)).size !==
      context.facts.length ||
    context.facts.some(
      (fact) =>
        !sources.has(fact.sourceId) ||
        !fact.id.startsWith(`${fact.sourceId}:`) ||
        fact.label !== context.sources.find(source => source.id === fact.sourceId)?.label ||
        !safeText(fact.label, 120) ||
        !safeText(fact.text, 700),
    )
  )
    throw new Error("Invalid evidence");
  return context;
}
function renderAnswer(context, factIds) {
  if (!context.facts.length) return UNAVAILABLE;
  if (context.clarification)
    return `Several campus records match. Which one do you mean? ${context.sources.map((source) => source.label).join("; ")}.`;
  const selected = factIds
    ? context.facts.filter((fact) => factIds.includes(fact.id))
    : context.facts.slice(0, 8);
  if (!selected.length) return UNAVAILABLE;
  return selected.map((fact) => `${fact.label}: ${fact.text}`).join("\n");
}
function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
async function bounded(work, ms, signal, code = "AI_TIMEOUT") {
  if (signal?.aborted) throw failure("AI_CANCELLED");
  const controller = new AbortController();
  let timer, abort;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(failure(code));
    }, ms);
    abort = () => {
      controller.abort();
      reject(failure("AI_CANCELLED"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
module.exports = {
  UNAVAILABLE,
  MAX_FACTS,
  MAX_CONTEXT_BYTES,
  MAX_PROMPT_BYTES,
  safeText,
  sensitiveQuestion,
  validatedContext,
  renderAnswer,
  bounded,
  failure,
};
