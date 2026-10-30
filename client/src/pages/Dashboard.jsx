import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Navigation, Users, UtensilsCrossed, BookOpen, Bus, CalendarDays, Star, Clock, Sparkles } from "lucide-react";
import { useUniverse } from "../lib/useUniverse.js";
import { useFavorites } from "../lib/useFavorites.js";
import CampusMap from "../components/CampusMap.jsx";
import AIConsole from "../components/AIConsole.jsx";
import { Counter, EmptyState } from "../components/ui.jsx";
import { motion } from "framer-motion";
import DataStatus from "../components/DataStatus.jsx";
import { campusDate, isFreshAvailability, mapLink } from "../lib/campusInfo.js";
import { upcomingEvents, verifiedEvent, campusTimestamp } from "../lib/notificationTime.js";

const QUICK_ACTIONS = [
  { label: "Navigate", sub: "Live maps & routes", icon: Navigation, to: "/map", iconBg: null },
  { label: "Find Faculty", sub: "Day-specific timetable gaps", icon: Users, to: "/faculty", iconBg: "#34C48C" },
  { label: "Find Food", sub: "Outlets & menus", icon: UtensilsCrossed, to: "/canteen", iconBg: "#F27BB8" },
  { label: "Study Spaces", sub: "Library & blocks", icon: BookOpen, to: "/map", iconBg: "#16A8E8" },
  { label: "Buses", sub: "Routes & stops", icon: Bus, to: "/buses", iconBg: "#E5A00D" },
  { label: "Events", sub: "Today & upcoming", icon: CalendarDays, to: "/events", iconBg: "#07579C" },
];

const CAT_ICON = {
  block: "🏢", library: "📚", shop: "🍴", hostel: "🏠", ground: "🌳", office: "🏛️", service: "🩺",
};

export default function Dashboard() {
  const { data, loading, error, errors, statuses, refresh } = useUniverse();
  const navigate = useNavigate();
  const { favorites, recents } = useFavorites();
  const pois = data.pois || [];
  const buses = data.buses || [];
  const faculty = data.faculty || [];
  const events = data.events || [];

  const today = campusDate();
  const upcoming = upcomingEvents(events);
  const todaysEvents = events.filter((e) => verifiedEvent(e) && (e.date || "").startsWith(today)).length;

  const snapshot = useMemo(() => {
    return [
      { key: "buses", icon: "🚌", num: buses.filter((b) => (b.status || "").toLowerCase().includes("route")).length, label: "Buses on route", sub: "Stored transport status", tint: "#E5A00D" },
      { key: "events", icon: "📅", num: todaysEvents, label: "Verified events today", sub: `${upcoming.length} verified upcoming`, tint: "#07579C" },
      { key: "pois", icon: "🍔", num: `${pois.filter((p) => p.type === "shop" && p.isOpenNow).length}/${pois.filter((p) => p.type === "shop").length}`, label: "Food outlets marked open", sub: "Stored outlet status", tint: "#F27BB8" },
      { key: "faculty", icon: "👨‍🏫", num: faculty.filter((person) => !person.onLeave && isFreshAvailability(person) && person.availability?.currentStatus === "free_in_timetable").length, label: "Free in timetable", sub: "Physical presence is not tracked", tint: "#34C48C" },
    ];
  }, [buses, events, pois, faculty, today]);

  const favList = favorites.length > 0 ? favorites : recents;

  const openShops = pois.filter((p) => p.type === "shop" && p.isOpenNow).length;
  const shops = pois.filter((p) => p.type === "shop").length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <DataStatus loading={loading} error={error} retry={refresh} />
      <div className="notification-dashboard-link"><Link to="/notifications">Campus announcements & deadlines</Link><span className="muted">Verified updates and your unread messages</span></div>
      {!loading && !error && ![pois, buses, faculty, events, data.departments || []].some((items) => items.length) && <EmptyState title="No campus information yet" subtitle="Information will appear here after an administrator adds it." />}
      <div className="dash-welcome">
        <div style={{ minWidth: 0 }}>
          <div className="dash-welcome-kicker">AIKYA Command Center</div>
          <h1>What's happening today?</h1>
        </div>
        <div className="dash-welcome-right">
          <span className="chip-row" style={{ gap: 8 }}>
            <span className="live-pill" style={{ padding: "6px 12px" }}><span className="pulse-dot" /> Campus information</span>
            {todaysEvents > 0 && (
              <span className="badge badge-accent">{todaysEvents} event{todaysEvents > 1 ? "s" : ""} today</span>
            )}
            {data.pois && <span className="badge badge-open">{openShops}/{shops} food outlets marked open</span>}
          </span>
        </div>
      </div>

      <div className="dash-layout">
        {/* Left — quick actions */}
        <div className="dash-col dash-col-left">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06, duration: 0.45 }}>
            <div className="dash-panel">
              <div className="quick-title">Quick actions</div>
              {QUICK_ACTIONS.map((a) => (
                <Link key={a.label} to={a.to} className="quick-tile">
                  <span className="qa-ic" style={a.iconBg ? { background: a.iconBg + "22", color: a.iconBg } : undefined}>
                    <a.icon size={20} />
                  </span>
                  <span>
                    <span className="qa-lbl">{a.label}</span>
                    <span className="qa-sub">{a.sub}</span>
                  </span>
                </Link>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Middle — AI hero + live campus */}
        <div className="dash-col dash-col-mid">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.5 }}>
            <AIConsole data={data} />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}>
            <div className="rich-card live-card" style={{ padding: 0 }}>
              <div className="live-head">
                <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="live-pill" style={{ padding: "4px 10px" }}><span className="pulse-dot" /></span>
                  Campus map · coordinates unverified unless confirmed
                </h3>
              </div>
              <CampusMap mode="dashboard" onNavigate={(poi) => navigate(mapLink(poi, pois))} />
            </div>
          </motion.div>
        </div>

        {/* Right — snapshots */}
        <div className="dash-col dash-col-right">
          {snapshot.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 + i * 0.05, duration: 0.45 }}>
              <div className="snapshot-card">
                <span className="snap-ic" style={{ background: s.tint + "22", color: s.tint }}>{s.icon}</span>
                <div>
                  <div className="snap-num">
                    {statuses?.[s.key] === "loading" && !data[s.key] ? <span className="skeleton" aria-label={`Loading ${s.label}`} style={{ display: "inline-block", width: 60, height: 26 }} /> : !data[s.key] ? "—" : typeof s.num === "number" ? <Counter value={s.num} /> : s.num}
                  </div>
                  <div className="snap-lbl">{s.label}</div>
                  <div className="snap-sub">{s.sub}</div>
                </div>
              </div>
            </motion.div>
          ))}

          {upcoming.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.34, duration: 0.45 }}>
              <div className="dash-panel" style={{ gap: 10 }}>
                <div className="quick-title">Next up</div>
                {upcoming.slice(0, 2).map((e) => (
                  <Link key={e._id} to="/events" className="quick-tile">
                    <span className="qa-ic">📅</span>
                    <span>
                      <span className="qa-lbl">{e.title}</span>
                      <span className="qa-sub">{e.date} · {e.startTime} · {e.venue}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Recent activity / favorites */}
      {favList.length > 0 && (
        <>
          <div className="dash-section-title">
            {favorites.length > 0 ? <><Star size={16} style={{ color: "var(--warning)" }} /> Favorite spots</> : <><Clock size={16} /> Recently viewed</>}
          </div>
          <div className="recent-row">
            {favList.map((p) => (
              <Link key={p._id} to={mapLink(p, pois)} className="recent-card">
                <span className="recent-ic">{CAT_ICON[p.type] || "📍"}</span>
                <span>
                  <strong>{p.name}</strong>
                  <span>{p.block || "Campus"}{p.floor ? ` · ${p.floor}` : ""}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Events strip */}
      <div className="dash-section-title"><Sparkles size={16} style={{ color: "var(--accent-strong)" }} /> Upcoming events</div>
      {loading ? (
        <div className="grid grid-3">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 100 }} />)}
        </div>
      ) : upcoming.length === 0 ? (
        !errors?.events && <EmptyState icon="📅" title="No upcoming events listed" subtitle="Check again after the campus calendar is updated." />
      ) : (
        <div className="grid grid-auto">
          {upcoming.slice(0, 6).map((e) => {
            return (
              <Link key={e._id} to="/events" className="rich-card">
                <div className="rc-head">
                  <span className="rc-avatar">📅</span>
                  <span>
                    <h3>{e.title}</h3>
                    <span className="rc-sub">{e.organizer}</span>
                  </span>
                </div>
                <div className="rc-rows">
                  <div className="rc-row"><CalendarDays size={15} /> {campusTimestamp(e.startsAt)}</div>
                  <div className="rc-row">📍 {e.venue}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
