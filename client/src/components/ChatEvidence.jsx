import { Link } from "react-router-dom";
export function evidenceCard(message, data = {}) {
  if (message.status !== "answered" || message.sources?.length !== 1)
    return null;
  const source = message.sources[0];
  const key = {
    Faculty: "faculty",
    Department: "departments",
    PointOfInterest: "pois",
    BusRoute: "buses",
    Event: "events",
  }[source.type];
  const item = (data[key] || []).find(
    (record) => record._id === source.recordId,
  );
  if (!item) return null;
  const kind =
    source.type === "Faculty"
      ? "faculty"
      : source.type === "BusRoute"
        ? "bus"
        : source.type === "Event"
          ? "event"
          : source.type === "Department"
            ? "location"
            : item.type === "shop"
              ? "food"
              : item.type === "hostel"
                ? "hostel"
                : "location";
  return { kind, item };
}
export function ExternalAIConsent({ checked, onChange, disabled }) {
  return (
    <label className="chat-consent">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span>
        Use optional external AI for this question and public records. Personal
        faculty/hostel questions stay local. Do not include private information.
      </span>
    </label>
  );
}
export default function ChatEvidence({ message, onRetry, onClarify, loading }) {
  const safeSources = (message.sources || []).filter((source) =>
    /^\/(?:faculty|departments|buses|events|canteen|hostels|map(?:\?poi=[a-f0-9]{24})?)$/.test(
      source.path || "",
    ),
  );
  return (
    <div className="chat-evidence">
      {message.status === "unavailable" && (
        <p role="status">Requested information or service is unavailable.</p>
      )}
      {(message.notices || []).map((notice, index) => (
        <p className="muted" key={index}>
          {notice}
        </p>
      ))}
      {!!safeSources.length && (
        <div aria-label="Campus answer sources">
          <strong>
            {message.status === "clarification"
              ? "Choose a matching record"
              : "Campus record sources"}
          </strong>
          <ul>
            {safeSources.map((source) => (
              <li key={source.id}>
                <Link to={source.path}>{source.label}</Link>
                {message.status === "clarification" && (
                  <button
                    className="btn btn-soft"
                    disabled={loading}
                    onClick={() => onClarify(`Tell me about ${source.label}`)}
                  >
                    Ask about {source.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {message.retryable && (
        <button
          className="btn btn-soft"
          onClick={() => onRetry(message.question)}
          disabled={loading}
        >
          Retry question
        </button>
      )}
      {message.escalated && (
        <p className="muted">
          No automatic referral was sent. Check the relevant campus directory
          for confirmed contact information.
        </p>
      )}
    </div>
  );
}
