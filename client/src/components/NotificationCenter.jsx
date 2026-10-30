import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { campusTimestamp } from "../lib/notificationTime.js";
import { enablePush, disablePush, pushSupported } from "../lib/pushNotifications.js";
export default function NotificationCenter({ compact = false }) {
  const { user } = useAuth() || {};
  const scope = user ? `${user.role}:${user.id || user.username}` : "guest";
  const [items, setItems] = useState([]), [page, setPage] = useState(1), [hasMore, setMore] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [revision, setRevision] = useState(0), [filter, setFilter] = useState("all"), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState("");
  const [reads, setReads] = useState({}), [loadedScope, setLoadedScope] = useState(null), [pushAvailable, setPushAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => api.pushConfig()).then(config => { if (active) setPushAvailable(!!config.enabled); }).catch(() => { if (active) setPushAvailable(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { setPage(1); setItems([]); try { setReads(JSON.parse(localStorage.getItem("aikya_notification_reads") || "{}")); } catch { setReads({}); } }, [scope]);
  useEffect(() => {
    const controller = new AbortController(); let mounted = true;
    setLoading(true); setError(""); setItems([]);
    api.notifications(page, controller.signal).then(result => { if (mounted) { setItems(result.items); setMore(result.hasMore); setLoadedScope(scope); } }).catch(() => { if (mounted) setError("Notifications could not be loaded. Please retry."); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; controller.abort(); };
  }, [page, revision, scope]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) setRevision(value => value + 1); }, 60000);
    return () => clearInterval(timer);
  }, []);
  const read = item => user ? !!item.readAt : !!reads[item._id];
  async function toggle(item) {
    setBusy(true); setFeedback("");
    try {
      if (user) { await api.readNotification(item._id, !read(item)); setItems(previous => previous.map(note => note._id === item._id ? { ...note, readAt: read(item) ? null : new Date().toISOString() } : note)); }
      else {
        const next = { ...reads }; if (read(item)) delete next[item._id]; else next[item._id] = Date.now();
        const trimmed = Object.fromEntries(Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, 300));
        localStorage.setItem("aikya_notification_reads", JSON.stringify(trimmed)); setReads(trimmed);
      }
    } catch { setFeedback("Read status could not be saved. Please retry."); }
    finally { setBusy(false); }
  }
  async function push(enable) {
    setBusy(true); setFeedback("");
    try { if (enable) await enablePush(); else await disablePush(); setFeedback(enable ? "Public announcement push enabled on this device for up to 90 days. Re-enable to renew." : "Push disabled on this device."); }
    catch (error) { setFeedback(error.message || "Push settings could not be saved. Please retry."); }
    finally { setBusy(false); }
  }
  const visible = (loadedScope === scope ? items : []).filter(item => new Date(item.expiresAt).getTime() > Date.now() && (filter !== "unread" || !read(item)));
  return <section className="notification-center" aria-label="Notification center">
    <div className="notification-toolbar">{compact ? <h2>Campus updates</h2> : <h1>Notifications</h1>}<button className="btn btn-soft" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh notifications</button></div>
    <p className="muted">Verified announcements only. All times are Asia/Kolkata. {user ? "Read status syncs with your account." : "Guest read status stays on this device."}</p>
    {!compact && <><label>Show <select aria-label="Filter notifications" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All updates</option><option value="unread">Unread</option></select></label>
      <details><summary>Optional browser notifications</summary><p>Public announcements only; no restricted content on your lock screen. Delivery depends on browser, connectivity and device settings. In-app updates work without permission.</p>
        <div className="notification-toolbar"><button className="btn btn-soft" disabled={busy || !pushAvailable || !pushSupported()} onClick={() => push(true)}>Enable public push on this device</button><button className="btn btn-soft" disabled={busy} onClick={() => push(false)}>Disable push / retry opt-out</button></div>
        {!pushAvailable && <p>Optional Web Push is not enabled or available on this server. Use the in-app center.</p>}
        {!pushSupported() && <p>Web Push is unavailable in this browser or context. On supported iPhones/iPads, install to the Home Screen first.</p>}</details></>}
    {feedback && <p role="status">{feedback}</p>}
    {loading ? <p role="status">Loading campus updates…</p> : error ? <div role="alert"><p>{error}</p><button className="btn btn-soft" onClick={() => setRevision(value => value + 1)}>Retry notifications</button></div> : <>
      {!visible.length && <div className="notification-empty"><h3>{filter === "unread" ? "No unread updates on this page" : "No current announcements"}</h3><p>Verified updates will appear here when their scheduled time arrives.</p><Link to="/events">Browse campus event records</Link></div>}
      <ul className="notification-list">{visible.slice(0, compact ? 3 : 20).map(item => <li key={item._id} className="rich-card"><article><div className="notification-toolbar"><span className="badge">{item.type}</span><span>{read(item) ? "Read" : "Unread"}</span></div><h3>{item.title}</h3><p className="notification-body">{item.body}</p>{item.occursAt && <p>{item.type === "deadline" ? "Deadline" : "When"}: <time dateTime={item.occursAt}>{campusTimestamp(item.occursAt)}</time></p>}<p className="muted">Published {campusTimestamp(item.scheduledAt)} · Expires {campusTimestamp(item.expiresAt)}</p><button className="btn btn-soft" disabled={busy} aria-label={`Mark ${item.title} ${read(item) ? "unread" : "read"}`} onClick={() => toggle(item)}>Mark {read(item) ? "unread" : "read"}</button></article></li>)}</ul>
      {!compact && <div className="notification-toolbar"><button className="btn btn-soft" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous updates</button><span>Page {page}</span><button className="btn btn-soft" disabled={!hasMore} onClick={() => setPage(value => value + 1)}>More updates</button></div>}
    </>}
    {compact && <Link to="/notifications">Open notification center</Link>}
  </section>;
}
