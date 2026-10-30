import { useState } from "react";
import { api } from "../api/client.js";
export function updatedLabel(value, field = "") {
  return value
    ? `${field} last updated: ${new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`
    : `${field} last updated: unknown`;
}
export function stockLabel(item) {
  const fresh =
    item.stock?.confirmation === "recent_report" &&
    item.stock?.expiresAt &&
    new Date(item.stock.expiresAt) > new Date();
  if (!fresh) return "Availability unconfirmed";
  return item.stock.reportedStatus === "in_stock"
    ? "Reported in stock — confirm with shop"
    : "Reported out of stock";
}
export function ShopSchedule({ shop }) {
  const state = shop.openingStatus?.state;
  const schedule = shop.openingSchedule;
  return (
    <div className="shop-schedule">
      <p>
        {state === "scheduled_open"
          ? "Scheduled open (not live confirmation)"
          : state === "scheduled_closed"
            ? "Scheduled closed"
            : "Opening status unconfirmed"}
      </p>
      <p>{shop.openHours || "Timings not listed"} · Asia/Kolkata</p>
      {schedule && (
        <details>
          <summary>Weekly hours, holidays and exceptions</summary>
          {[
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ].map((day) => (
            <p key={day}>
              {day}:{" "}
              {schedule.weekly?.[day]
                ? schedule.weekly[day]
                    .map((p) => `${p.start}–${p.end}`)
                    .join(", ") || "Closed"
                : "Unconfirmed"}
            </p>
          ))}
          {["holidays", "exceptions"].map((key) => (
            <div key={key}>
              <strong>{key}</strong>
              {schedule[key]?.length ? (
                schedule[key].map((entry) => (
                  <p key={entry.date}>
                    {entry.date} {entry.label}:{" "}
                    {entry.periods
                      .map((p) => `${p.start}–${p.end}`)
                      .join(", ") || "Closed"}
                  </p>
                ))
              ) : (
                <p>No dates supplied; holiday opening is unconfirmed.</p>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
export function ReportListing({ shop }) {
  const [reason, setReason] = useState("stock"),
    [itemId, setItemId] = useState(""),
    [message, setMessage] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const result = await api.create(`shops/${shop._id}/feedback`, {
        reason,
        message,
        ...(itemId ? { itemId } : {}),
      });
      setStatus(result.message);
      setMessage("");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="shop-feedback">
      <summary>Report an inaccurate listing</summary>
      <p className="muted">
        Student/guest reports are unverified and reviewed by an admin. Do not
        include personal information.
      </p>
      <form onSubmit={submit} className="shop-form">
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {["stock", "price", "hours", "location", "other"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Item
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Whole shop</option>
            {shop.items.map((item) => (
              <option value={item._id} key={item._id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          What is inaccurate?
          <textarea
            required
            minLength={5}
            maxLength={1000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <button disabled={busy} className="btn btn-soft">
          {busy ? "Submitting…" : "Send for review"}
        </button>
        <p role="status">{status}</p>
      </form>
    </details>
  );
}
