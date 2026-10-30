const express = require("express");
const { adminOnly } = require("../middleware/auth");
const DefaultQueryLog = require("../models/QueryLog");
const campus = require("../services/campusDataService");
const ai = require("../services/aiService");
const { asyncRoute } = require("../middleware/errors");
const { parse, chat, validateQuery } = require("../validation");
const {
  UNAVAILABLE,
  validatedContext,
  renderAnswer,
  bounded,
  sensitiveQuestion,
} = require("../services/chatPolicy");
const RETENTION_MS = 7 * 86400000;
const PROVIDER_CODES = new Set([
  "AI_NOT_CONFIGURED",
  "AI_BAD_CONFIG",
  "AI_TIMEOUT",
  "AI_CANCELLED",
  "AI_INVALID_RESPONSE",
  "AI_RATE_LIMITED",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_NO_PUBLIC_EVIDENCE",
  "AI_PRIVATE_INPUT",
]);
function createChatRouter({
  QueryLog = DefaultQueryLog,
  retrieveCampusContext = campus.retrieveCampusContext,
  answerCampusQuestion = ai.answerCampusQuestion,
  limiter,
  maxConcurrent = 4,
} = {}) {
  const router = express.Router();
  let inFlight = 0;
  async function telemetry(result, started) {
    try {
      await bounded(
        async () => {
          const indexes = await QueryLog.listIndexes();
          if (
            !indexes.some(
              (index) =>
                index.key?.expiresAt === 1 &&
                Object.keys(index.key).length === 1 &&
                index.expireAfterSeconds === 0 &&
                !index.partialFilterExpression,
            )
          )
            return;
          await QueryLog.create({
            status: result.status,
            providerStatus: result.providerStatus,
            sourceCount: result.sources.length,
            wasEscalated: result.escalated,
            latencyMs: Math.min(60000, Date.now() - started),
            expiresAt: new Date(Date.now() + RETENTION_MS),
          });
        },
        300,
        undefined,
        "TELEMETRY_TIMEOUT",
      );
    } catch {
      /* Aggregate-only logging must never discard an answer or leak a question. */
    }
  }
  router.post(
    "/",
    limiter,
    validateQuery(),
    asyncRoute(async (req, res) => {
      const { message, allowExternalAI } = parse(chat, req.body);
      if (inFlight >= maxConcurrent)
        return res
          .status(429)
          .set("Retry-After", "5")
          .json({
            error: "Campus assistant is busy; retry shortly",
            retryable: true,
          });
      const controller = new AbortController(),
        started = Date.now();
      const abort = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on("close", abort);
      inFlight++;
      let result;
      try {
        result = await bounded(
          async (signal) => {
            let context;
            try {
              context = validatedContext(
                (
                  await bounded(
                    (child) =>
                      retrieveCampusContext(message, { signal: child }),
                    3000,
                    signal,
                    "RETRIEVAL_TIMEOUT",
                  )
                ).context,
              );
            } catch {
              return {
                answer: ai.FALLBACK_MESSAGE,
                status: "unavailable",
                providerStatus: "retrieval_unavailable",
                retryable: true,
                escalated: false,
                sources: [],
                notices: [
                  "Campus records could not be checked. No provider answer was requested.",
                ],
              };
            }
            let providerStatus = "local",
              selection;
            if (
              allowExternalAI &&
              !sensitiveQuestion(message) &&
              !context.clarification &&
              context.facts.some((fact) => fact.externalAllowed)
            ) {
              try {
                selection = await answerCampusQuestion({
                  question: message,
                  context,
                  signal,
                });
                // Enforce evidence membership again at the route boundary, including injected services.
                if (
                  !selection ||
                  !Array.isArray(selection.factIds) ||
                  selection.factIds.length > 8 ||
                  selection.factIds.some(
                    (id) =>
                      !context.facts.some(
                        (fact) => fact.id === id && fact.externalAllowed,
                      ),
                  )
                )
                  throw new Error("Invalid selection");
                providerStatus = "used";
              } catch (error) {
                selection = undefined;
                providerStatus = PROVIDER_CODES.has(error.code)
                  ? error.code.toLowerCase()
                  : "ai_provider_unavailable";
              }
            } else if (allowExternalAI && sensitiveQuestion(message))
              providerStatus = "privacy_local_only";
            const answer = renderAnswer(context, selection?.factIds);
            const status = context.clarification
              ? "clarification"
              : answer === UNAVAILABLE
                ? "unavailable"
                : "answered";
            const usedSources = context.clarification
              ? context.sources
              : context.sources.filter((source) =>
                  context.facts.some(
                    (fact) =>
                      fact.sourceId === source.id &&
                      (selection
                        ? selection.factIds.includes(fact.id)
                        : context.facts.slice(0, 8).includes(fact)),
                  ),
                );
            const providerFailed = ![
              "used",
              "local",
              "privacy_local_only",
            ].includes(providerStatus);
            return {
              answer: [answer, ...context.notices].join("\n"),
              status,
              providerStatus,
              retryable:
                providerFailed &&
                ![
                  "ai_not_configured",
                  "ai_bad_config",
                  "ai_private_input",
                  "ai_no_public_evidence",
                ].includes(providerStatus),
              escalated: status === "unavailable",
              sources: usedSources,
              notices: [
                ...context.notices,
                ...(providerStatus === "privacy_local_only"
                  ? [
                      "This question was handled locally to protect personal information.",
                    ]
                  : providerFailed
                    ? [
                        "External AI is unavailable; showing only retrieved campus records.",
                      ]
                    : []),
              ],
            };
          },
          14000,
          controller.signal,
          "CHAT_TIMEOUT",
        );
      } catch {
        result = {
          answer: ai.FALLBACK_MESSAGE,
          status: "unavailable",
          providerStatus: "timeout",
          retryable: true,
          escalated: false,
          sources: [],
          notices: [],
        };
      } finally {
        inFlight--;
        res.removeListener("close", abort);
      }
      if (controller.signal.aborted || res.destroyed) return;
      await telemetry(result, started);
      res.json(result);
    }),
  );
  router.get(
    "/analytics",
    adminOnly,
    validateQuery(),
    asyncRoute(async (req, res) => {
      const filter = { expiresAt: { $gt: new Date() } };
      const [total, escalated, recent] = await Promise.all([
        QueryLog.countDocuments(filter, { maxTimeMS: 1000 }),
        QueryLog.countDocuments(
          { ...filter, wasEscalated: true },
          { maxTimeMS: 1000 },
        ),
        QueryLog.find(filter)
          .select(
            "status providerStatus sourceCount latencyMs wasEscalated createdAt expiresAt",
          )
          .sort({ createdAt: -1, _id: -1 })
          .limit(20)
          .maxTimeMS(1000),
      ]);
      const allowed = [
        "_id",
        "status",
        "providerStatus",
        "sourceCount",
        "latencyMs",
        "wasEscalated",
        "createdAt",
        "expiresAt",
      ];
      res.json({
        total,
        escalated,
        recent: recent.map((document) => {
          const value = document.toObject ? document.toObject() : document;
          return Object.fromEntries(
            allowed
              .filter((key) => value[key] !== undefined)
              .map((key) => [key, value[key]]),
          );
        }),
      });
    }),
  );
  return router;
}
module.exports = createChatRouter;
