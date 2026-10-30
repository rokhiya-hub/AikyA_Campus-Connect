import { useEffect, useState } from "react";
import { api } from "../api/client.js";
export default function BusTrackingAdmin() {
  const [routes, setRoutes] = useState([]),
    [devices, setDevices] = useState([]),
    [page, setPage] = useState(1),
    [more, setMore] = useState(false),
    [busId, setBus] = useState(""),
    [label, setLabel] = useState(""),
    [expiry, setExpiry] = useState(""),
    [provisioned, setProvisioned] = useState(null),
    [status, setStatus] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [enabled, setEnabled] = useState(false);
  const [trips, setTrips] = useState([]),
    [tripPage, setTripPage] = useState(1),
    [tripMore, setTripMore] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setStatus("");
    (async () => {
      const config = await api.trackingStatus();
      if (!live) return;
      setEnabled(config.enabled);
      if (!config.enabled) return;
      const [buses, result, active] = await Promise.all([
        api.getBuses(),
        api.trackingDevices(page),
        api.trackingTrips(tripPage),
      ]);
      if (live) {
        setRoutes(buses);
        setDevices(result.data);
        setMore(result.hasMore);
        setTrips(active.data);
        setTripMore(active.hasMore);
      }
    })()
      .catch((error) => {
        if (live) setStatus(error.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [page, tripPage, revision]);
  async function endListed(id) {
    try {
      await api.create(`bus-tracking/trips/${id}/end`, {});
      setRevision((value) => value + 1);
    } catch (error) {
      setStatus(error.message);
    }
  }
  async function toggle(route) {
    try {
      await api.update("buses", route._id, {
        trackingEnabled: !route.trackingEnabled,
      });
      setRevision((value) => value + 1);
    } catch (error) {
      setStatus(error.message);
    }
  }
  async function authorize(event) {
    event.preventDefault();
    setStatus("");
    setProvisioned(null);
    try {
      const result = await api.authorizeBusDevice({
        busId,
        label,
        expiresAt: new Date(expiry).toISOString(),
      });
      setProvisioned(result);
      setRevision((value) => value + 1);
    } catch (error) {
      setStatus(error.message);
    }
  }
  async function revoke(id) {
    try {
      await api.revokeBusDevice(id);
      setRevision((value) => value + 1);
    } catch (error) {
      setStatus(error.message);
    }
  }
  async function end(event) {
    event.preventDefault();
    const id = new FormData(event.currentTarget).get("tripId");
    try {
      await api.create(`bus-tracking/trips/${id}/end`, {});
      setStatus("Trip ended; its latest location is no longer public.");
    } catch (error) {
      setStatus(error.message);
    }
  }
  return (
    <section>
      <h2>Bus tracking administration</h2>
      <p>
        Authorize only a device attached to a campus bus. No individual location
        tracking is supported. Revoking a device invalidates its sessions and
        hides its bus location; enabling a bus alone does not start GPS.
      </p>
      <p role="status">
        {loading ? "Loading tracking configuration…" : status}
      </p>
      <button
        className="btn btn-soft"
        onClick={() => setRevision((value) => value + 1)}
      >
        Reload tracking administration
      </button>
      {!enabled && !loading ? (
        <p>
          Optional tracking is disabled on the server. Route browsing is
          unchanged.
        </p>
      ) : (
        <>
          <h3>Eligible bus routes</h3>
          {routes.map((route) => (
            <div className="rich-card" key={route._id}>
              <h4>Route {route.routeNumber}</h4>
              <button className="btn btn-soft" onClick={() => toggle(route)}>
                {route.trackingEnabled ? "Disable tracking" : "Enable tracking"}{" "}
                for route {route.routeNumber}
              </button>
            </div>
          ))}
          <form className="rich-card shop-form" onSubmit={authorize}>
            <h3>Authorize a device</h3>
            <label>
              Assigned bus
              <select
                required
                value={busId}
                onChange={(e) => setBus(e.target.value)}
              >
                <option value="">Select a tracking-enabled route</option>
                {routes
                  .filter((route) => route.trackingEnabled)
                  .map((route) => (
                    <option value={route._id} key={route._id}>
                      Route {route.routeNumber}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Device label (not a driver's personal name)
              <input
                required
                maxLength={200}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label>
              Authorization expires (your local time, within 30 days)
              <input
                required
                type="datetime-local"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </label>
            <button className="btn btn-primary">
              Create one-time device credential
            </button>
          </form>
          {provisioned && (
            <aside
              className="tracking-warning"
              aria-label="One-time device credential"
            >
              <p>
                Deliver these credentials securely to the assigned device. This
                secret is shown only now and is never recoverable from the
                device list. Do not put it in a URL or frontend environment
                file.
              </p>
              <p>
                Device ID: <code>{provisioned._id}</code>
              </p>
              <label className="shop-form">
                One-time device secret
                <input
                  readOnly
                  type="password"
                  value={provisioned.secret}
                  autoComplete="off"
                />
              </label>
              <button
                className="btn btn-soft"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(
                      `Device ID: ${provisioned._id}\nSecret: ${provisioned.secret}`,
                    )
                    .catch(() =>
                      setStatus(
                        "Clipboard unavailable; use secure manual credential transfer.",
                      ),
                    );
                }}
              >
                Copy credential
              </button>
              <button
                className="btn btn-soft"
                onClick={() => setProvisioned(null)}
              >
                Clear credential from screen
              </button>
            </aside>
          )}
          <h3>Device authorizations</h3>
          {!devices.length && !loading && <p>No devices on this page.</p>}
          {devices.map((device) => (
            <article className="rich-card" key={device._id}>
              <h4>{device.label}</h4>
              <p>
                Device: <code>{device._id}</code> · Bus:{" "}
                <code>{device.busId}</code>
              </p>
              <p>
                {device.enabled ? "Enabled" : "Revoked"}; expires{" "}
                {new Date(device.expiresAt).toLocaleString()}
              </p>
              <button
                className="btn btn-soft"
                disabled={!device.enabled}
                onClick={() => revoke(device._id)}
              >
                Revoke {device.label}
              </button>
            </article>
          ))}
          <nav className="shop-pagination" aria-label="Tracking device pages">
            <button
              className="btn btn-soft"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous devices
            </button>
            <span>Page {page}</span>
            <button
              className="btn btn-soft"
              disabled={!more}
              onClick={() => setPage((value) => value + 1)}
            >
              Next devices
            </button>
          </nav>
          <form className="shop-form" onSubmit={end}>
            <h3>Dispatched trips (including expired leases)</h3>
            {trips.map((trip) => (
              <article className="rich-card" key={trip._id}>
                <p>
                  Trip <code>{trip._id}</code> · Bus <code>{trip.busId}</code>
                </p>
                <p>
                  Lease expires:{" "}
                  {new Date(trip.leaseExpiresAt).toLocaleString()}
                </p>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => endListed(trip._id)}
                >
                  End trip {trip._id}
                </button>
              </article>
            ))}
            <nav className="shop-pagination" aria-label="Dispatched trip pages">
              <button
                type="button"
                className="btn btn-soft"
                disabled={tripPage === 1}
                onClick={() => setTripPage((value) => value - 1)}
              >
                Previous trips
              </button>
              <span>Page {tripPage}</span>
              <button
                type="button"
                className="btn btn-soft"
                disabled={!tripMore}
                onClick={() => setTripPage((value) => value + 1)}
              >
                Next trips
              </button>
            </nav>
            <h3>End a dispatched or abandoned trip</h3>
            <label>
              Trip ID
              <input
                name="tripId"
                required
                maxLength={24}
                pattern="[a-fA-F0-9]{24}"
              />
            </label>
            <p>
              Use the trip ID from the active bus feed or the authorized device
              operator. End expired trips before dispatching the same bus again.
            </p>
            <button className="btn btn-soft">End trip</button>
          </form>
        </>
      )}
    </section>
  );
}
