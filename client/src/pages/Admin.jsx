import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import AdminCrud from "../components/AdminCrud.jsx";
import FacultyPortal from "../components/FacultyPortal.jsx";
import { ShopAdmin, ShopCatalogEditor, ShopOwnerRegistration } from "../components/ShopManagement.jsx";
import BusTrackingAdmin from "../components/BusTrackingAdmin.jsx";
import NotificationAdmin from "../components/NotificationAdmin.jsx";
import { ENTITIES } from "../admin/entityConfig.js";

function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState("admin"); // "admin" | "faculty"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(username.trim(), password, mode);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="admin-login-wrap">
      <form className="admin-login" onSubmit={handleSubmit}>
        <h2>Sign in</h2>
        <p className="muted" style={{ margin: "0 0 4px" }}>Sign in as campus admin, faculty or an approved shop owner.</p>

        <div className="faculty-role-switch">
          <button type="button" className={mode === "shop_owner" ? "active" : ""} onClick={() => { setMode("shop_owner"); setError(""); }}>Shop owner</button>
          <button
            type="button"
            className={mode === "admin" ? "active" : ""}
            onClick={() => { setMode("admin"); setError(""); }}
          >
            🛡️ Admin
          </button>
          <button
            type="button"
            className={mode === "faculty" ? "active" : ""}
            onClick={() => { setMode("faculty"); setError(""); }}
          >
            🎓 Faculty
          </button>
        </div>

        <label className="admin-field">
          <span>{mode === "admin" ? "Admin username" : mode === "shop_owner" ? "Shop-owner email" : "Faculty email"}</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus
            placeholder={mode === "admin" ? "admin" : "you@adityauniversity.in"} />
        </label>
        <label className="admin-field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="admin-error">{error}</div>}
        <button type="submit" className="admin-btn primary" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <ShopOwnerRegistration />
    </div>
  );
}

function AdminDashboard() {
  const { user, logout } = useAuth();
  const [active, setActive] = useState(ENTITIES[0].key);

  const entity = ENTITIES.find((e) => e.key === active);

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <h1>Admin Panel</h1>
        <div className="admin-header-right">
          <span className="muted">Signed in as <strong>{user?.username}</strong></span>
          <button className="admin-btn" onClick={logout}>Log out</button>
        </div>
      </header>
      <nav className="admin-tabs">
        <button className={`admin-tab ${active === "notifications" ? "active" : ""}`} onClick={() => setActive("notifications")}>Announcements</button>
        <button className={`admin-tab ${active === "bus-tracking" ? "active" : ""}`} onClick={() => setActive("bus-tracking")}>Bus tracking</button>
        <button className={`admin-tab ${active === "shop-management" ? "active" : ""}`} onClick={() => setActive("shop-management")}>Shops & owners</button>
        {ENTITIES.map((e) => (
          <button
            key={e.key}
            className={`admin-tab ${active === e.key ? "active" : ""}`}
            onClick={() => setActive(e.key)}
          >
            {e.label}
          </button>
        ))}
      </nav>
      <main className="admin-main">
        {active === "notifications" ? <NotificationAdmin /> : active === "bus-tracking" ? <BusTrackingAdmin /> : active === "shop-management" ? <ShopAdmin /> : <AdminCrud key={entity.key} entity={entity} />}
      </main>
    </div>
  );
}

function FacultyDashboard() {
  const { user, logout } = useAuth();
  return (
    <FacultyPortal facultyId={user?.id} onLogout={logout} />
  );
}

export default function Admin() {
  const { user, loading, logout } = useAuth();

  if (loading) return <div className="admin-page"><p className="muted">Loading...</p></div>;
  if (!user) return <div className="admin-page"><Login /></div>;
  if (user?.role === "faculty") return <div className="admin-page"><FacultyDashboard /></div>;
  if (user?.role === "shop_owner") return <div className="admin-page"><header className="admin-header"><h1>Shop owner portal</h1><button className="admin-btn" onClick={logout}>Log out</button></header><ShopCatalogEditor owner /></div>;
  if (user?.role !== "admin") return <div className="admin-page"><p>Use the dedicated driver tracking page for device sessions.</p><button className="admin-btn" onClick={logout}>Log out</button></div>;
  return <div className="admin-page"><AdminDashboard /></div>;
}
