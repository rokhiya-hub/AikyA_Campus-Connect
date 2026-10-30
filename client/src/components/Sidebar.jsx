import { NavLink, Link } from "react-router-dom";
import { useEffect, useRef } from "react";
import {
  Home, Map, Users, Building2, UtensilsCrossed, Bus, Hotel, CalendarDays, ShieldCheck, PanelsLeftBottom, Sparkles, Bell,
} from "lucide-react";

export const NAV_SECTIONS = [
  {
    label: "Main",
    items: [
      { to: "/", label: "Home", icon: Home, end: true },
      { to: "/map", label: "Explore", icon: Map },
      { to: "/faculty", label: "People", icon: Users },
      { to: "/departments", label: "Departments", icon: Building2 },
    ],
  },
  {
    label: "Campus",
    items: [
      { to: "/canteen", label: "Food", icon: UtensilsCrossed },
      { to: "/buses", label: "Transit", icon: Bus },
      { to: "/hostels", label: "Hostels", icon: Hotel },
      { to: "/events", label: "Events", icon: CalendarDays },
      { to: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/admin", label: "Admin", icon: ShieldCheck },
    ],
  },
];

export const MOBILE_NAV = [
  { to: "/", label: "Home", icon: Sparkles, end: true },
  { to: "/map", label: "Explore", icon: Map },
  { to: "/canteen", label: "Food", icon: UtensilsCrossed },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/admin", label: "Admin", icon: ShieldCheck },
];

export function SidebarLinks() {
  return NAV_SECTIONS.flatMap((s, si) => [
    <div key={`label-${si}`} className="sidebar-section-label">{s.label}</div>,
    ...s.items.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        data-tip={item.label}
        className={({ isActive }) => "sidebar-link" + (isActive ? " active" : "")}
      >
        <span className="sl-icon"><item.icon size={19} strokeWidth={2.1} /></span>
        <span className="sl-label">{item.label}</span>
      </NavLink>
    )),
  ]);
}

export default function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onMobileClose }) {
  const closeButton = useRef(null);
  useEffect(() => {
    if (!mobileOpen) return;
    closeButton.current?.focus();
    return () => document.querySelector(".topbar-mobile-menu")?.focus();
  }, [mobileOpen]);
  function keyboard(event) {
    if (!mobileOpen) return;
    if (event.key === "Escape") onMobileClose();
    if (event.key === "Tab") {
      const controls = [...event.currentTarget.querySelectorAll("a, button")].filter(element => element.offsetParent !== null);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={onMobileClose} aria-hidden />}
      <aside className={`sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " open" : ""}`} onKeyDown={keyboard}>
        <button ref={closeButton} className="btn btn-soft sidebar-mobile-close" onClick={onMobileClose}>Close navigation</button>
        <Link to="/" className="sidebar-logo">
          <span className="sidebar-logo-mark">✦</span>
          <span className="sidebar-logo-text">AIKYA</span>
        </Link>

        <nav className="sidebar-nav" aria-label="Campus pages" onClick={event => { if (event.target.closest("a")) onMobileClose(); }}>
          <SidebarLinks />
        </nav>

        <div className="sidebar-footer">
          <button
            className="icon-btn sidebar-toggle-desktop"
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelsLeftBottom size={16} />
          </button>
          <span className="micro">ONE CAMPUS · CONNECTED</span>
        </div>
      </aside>
    </>
  );
}

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {MOBILE_NAV.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
          <span className="bn-icon"><item.icon size={18} strokeWidth={2.2} /></span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
