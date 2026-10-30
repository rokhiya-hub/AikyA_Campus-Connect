import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { campusInput, campusISO, campusTimestamp } from "../lib/notificationTime.js";
const empty = () => ({ title: "", body: "", type: "announcement", audience: "public", recipient: "", eventId: "", status: "draft", scheduledAt: "", expiresAt: "", occursAt: "", source: "", verified: false });
export default function NotificationAdmin() {
  const [items, setItems] = useState([]), [page, setPage] = useState(1), [more, setMore] = useState(false), [form, setForm] = useState(empty), [editing, setEditing] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [feedback, setFeedback] = useState(""), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setError("");
    api.adminNotifications(page).then(result => { if (active) { setItems(result.items); setMore(result.hasMore); } }).catch(() => { if (active) setError("Announcements could not be loaded. Retry below."); });
    return () => { active = false; };
  }, [page, revision]);
  const change = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(""); setFeedback("");
    try {
      await api.saveNotification(editing, { title: form.title, body: form.body, type: form.type, audience: form.audience, ...(form.audience === "recipient" ? { recipient: form.recipient } : {}), eventId: form.eventId || null, status: form.status, scheduledAt: campusISO(form.scheduledAt), expiresAt: campusISO(form.expiresAt), occursAt: campusISO(form.occursAt), timezone: "Asia/Kolkata", verification: { status: form.verified ? "verified" : "unverified", source: form.source, ...(form.verified ? { verifiedAt: new Date().toISOString() } : {}) } });
      setForm(empty()); setEditing(null); setRevision(value => value + 1); setFeedback("Announcement saved. Scheduled records appear only when due and verified.");
    } catch (error) { setError(error.message || "Announcement could not be saved."); }
    finally { setBusy(false); }
  }
  function edit(item) {
    setEditing(item._id); setForm({ ...item, scheduledAt: campusInput(item.scheduledAt), expiresAt: campusInput(item.expiresAt), occursAt: campusInput(item.occursAt), source: item.verification?.source || "", verified: item.verification?.status === "verified", recipient: item.recipient || "", eventId: item.eventId || "" });
    document.getElementById("announcement-title")?.focus();
  }
  async function cancel(item) {
    setBusy(true); setError("");
    try { await api.cancelNotification(item._id); setFeedback("Announcement cancelled. Already delivered push notices cannot be recalled."); setRevision(value => value + 1); }
    catch { setError("Cancellation could not be saved. Retry."); }
    finally { setBusy(false); }
  }
  async function deliveries(item) {
    setBusy(true);
    try { const result = await api.notificationDeliveries(item._id); setFeedback(`${item.title}: ${Object.entries(result.counts).map(([key, value]) => `${key}: ${value}`).join(", ")}. Accepted means push service acceptance, not confirmed display.`); }
    catch { setError("Delivery status unavailable."); } finally { setBusy(false); }
  }
  return <section className="notification-admin"><h2>Announcements & deadlines</h2><p className="muted">All date/time controls use Asia/Kolkata, including on devices in other timezones. Verify against an official source before scheduling. No automatic event alerts are created.</p>
    {error && <div role="alert">{error} <button className="btn btn-soft" onClick={() => setRevision(value => value + 1)}>Retry announcements</button></div>}{feedback && <p role="status">{feedback}</p>}
    <form onSubmit={save} className="notification-form">
      <label className="admin-field">Title<input id="announcement-title" required maxLength={160} value={form.title} onChange={event => change("title", event.target.value)} /></label>
      <label className="admin-field">Message<textarea required maxLength={2000} value={form.body} onChange={event => change("body", event.target.value)} /></label>
      <label className="admin-field">Type<select value={form.type} onChange={event => change("type", event.target.value)}>{["announcement", "event", "deadline"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="admin-field">Audience<select value={form.audience} onChange={event => change("audience", event.target.value)}>{["public", "authenticated", "faculty", "admin", "shop_owner", "recipient"].map(value => <option key={value}>{value}</option>)}</select></label>
      {form.audience === "recipient" && <label className="admin-field">Recipient (role:account ID)<input required value={form.recipient} onChange={event => change("recipient", event.target.value)} /></label>}
      <label className="admin-field">Related event ID (optional)<input value={form.eventId} onChange={event => change("eventId", event.target.value)} /></label>
      {[['scheduledAt', 'Publish at (Asia/Kolkata)'], ['expiresAt', 'Expire at (Asia/Kolkata)'], ['occursAt', 'Event/deadline at (Asia/Kolkata)']].map(([key, label]) => <label className="admin-field" key={key}>{label}<input type="datetime-local" required={key !== "occursAt" || form.type !== "announcement"} value={form[key]} onChange={event => change(key, event.target.value)} /></label>)}
      <label className="admin-field">Official source/reference<input maxLength={1000} required={form.verified} value={form.source} onChange={event => change("source", event.target.value)} /></label>
      <label><input type="checkbox" checked={form.verified} onChange={event => change("verified", event.target.checked)} /> I have verified this content and its dates against the official source</label>
      <label className="admin-field">Save as<select value={form.status} onChange={event => change("status", event.target.value)}><option value="draft">Draft</option><option value="scheduled">Scheduled (official verification required)</option></select></label>
      <div className="notification-toolbar"><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save announcement" : "Create announcement"}</button>{editing && <button type="button" className="btn btn-soft" onClick={() => { setEditing(null); setForm(empty()); }}>Discard edit</button>}</div>
    </form>
    <h3>Saved announcements</h3><p>Drafts can be edited and scheduled. Scheduled records are immutable; cancel and create a replacement to preserve delivery history.</p>
    {!items.length && <p>No announcements yet. Create a draft above.</p>}
    <ul className="notification-list">{items.map(item => <li key={item._id} className="rich-card"><h4>{item.title}</h4><p>{item.status} · {item.audience} · {campusTimestamp(item.scheduledAt)}</p><div className="notification-toolbar">{item.status === "draft" && <button className="btn btn-soft" disabled={busy} onClick={() => edit(item)}>Edit {item.title}</button>}{item.status !== "cancelled" && <button className="btn btn-soft" disabled={busy} onClick={() => cancel(item)}>Cancel {item.title}</button>}<button className="btn btn-soft" disabled={busy} onClick={() => deliveries(item)}>Delivery status for {item.title}</button></div></li>)}</ul>
    <div className="notification-toolbar"><button className="btn btn-soft" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous announcements</button><span>Page {page}</span><button className="btn btn-soft" disabled={!more} onClick={() => setPage(value => value + 1)}>More announcements</button></div>
  </section>;
}
