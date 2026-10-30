import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Menu, Sun, Moon, ChevronLeft, Bell, CalendarDays, Lock, X, Palmtree, ShieldCheck, Map as MapIcon } from "lucide-react";
import GlobalSearch from "./GlobalSearch.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { NAV_SECTIONS } from "./Sidebar.jsx";

const LABEL_MAP = Object.fromEntries(
  NAV_SECTIONS.flatMap((s) => s.items).map((i) => [i.to, i.label])
);

const CENTER_LINKS = [
  { to: "/", label: "Home", exact: true },
  { to: "/map", label: "Explore" },
  { to: "/faculty", label: "People" },
  { to: "/canteen", label: "Food" },
  { to: "/buses", label: "Transit" },
  { to: "/events", label: "Events" },
];

function NotificationsBell() {
  return <Link to="/notifications" className="icon-btn" aria-label="Open notification center" title="Notifications"><Bell size={17} /></Link>;
}
function ProfileChip() {
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className="position-relative" style={{ position: "relative" }} ref={ref}>
      <button className="profile-chip" onClick={() => setOpen((o) => !o)} title="Profile" aria-label="Profile">
        ◈
      </button>
      {open && (
        <div className="profile-pop">
          <div style={{ padding: "10px 12px" }}>
            <strong style={{ fontSize: 13.5, display: "block" }}>Campus guest</strong>
            <span className="muted" style={{ fontSize: 11.5 }}>Browse public campus information</span>
          </div>
          <button onClick={toggle}>
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <Link to="/admin"><ShieldCheck size={15} /> Admin console</Link>
          <Link to="/map"><MapIcon size={15} /> Explore map</Link>
          <Link to="/home"><Palmtree size={15} /> Landing page</Link>
        </div>
      )}
    </div>
  );
}

export default function Navbar({ onMenuClick }) {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const parts = pathname.split("/").filter(Boolean);
  let crumbPath = "";
  for (const p of parts) {
    const candidate = "/" + parts.slice(0, parts.indexOf(p) + 1).join("/");
    if (LABEL_MAP[candidate]) crumbPath = candidate;
  }
  const rootMatch = "/" + (parts[0] || "");
  const label = LABEL_MAP[crumbPath] ?? LABEL_MAP[rootMatch] ?? "Home";
  const isActive = (l) => (l.exact ? pathname === l.to : pathname === l.to || pathname.startsWith(l.to + "/"));

  return (
    <header className="topbar">
      <button className="topbar-mobile-menu" onClick={onMenuClick} aria-label="Open menu">
        <Menu size={22} />
      </button>

      <Link to="/" className="brand" title="AIKYA — one campus, connected">
        <span className="brand-mark">✦</span>
        <span>
          <span className="brand-name">AIKYA</span>
          <span className="brand-tag">Your Campus · One Intelligence</span>
        </span>
      </Link>

      <nav className="topbar-links" aria-label="Primary">
        {CENTER_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className={isActive(l) ? "active" : ""}>
            {l.label}
          </Link>
        ))}
      </nav>

      <div className="breadcrumbs">
        <button
          className="btn-ghost"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "none", cursor: "pointer", color: "inherit", padding: 0 }}
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="breadcrumb-current">{label}</span>
      </div>

      <div className="topbar-search">
        <GlobalSearch />
      </div>

      <div className="topbar-right">
        <NotificationsBell />
        <button className="icon-btn" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <ProfileChip />
        <button className="btn btn-primary" onClick={() => navigate(pathname === "/map" ? "/" : "/map")}>
          {pathname === "/map" ? "Home" : "Explore Map"}
        </button>
      </div>
    </header>
  );
}
