import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { simulationAllowed } from "../lib/trackingConfig.js";
import { simulatedBus } from "../lib/busSimulation.js";
import BusTrackingMap from "./BusTrackingMap.jsx";
export function visibleBus(bus, now = Date.now()) {
  if (bus.trackingStatus === "simulated") return bus;
  const age = bus.receivedAt
    ? Math.max(0, now - new Date(bus.receivedAt).getTime())
    : Infinity;
  const expired =
    bus.authorizationExpiresAt &&
    new Date(bus.authorizationExpiresAt).getTime() <= now;
  const status =
    expired || age >= 90000
      ? "offline"
      : age > 30000
        ? "stale"
        : bus.trackingStatus;
  return {
    ...bus,
    trackingStatus: status,
    location: status === "offline" ? null : bus.location,
  };
}
export default function LiveBusTracking({ routes = [] }) {
  const [busId, setBus] = useState(""),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0),
    [simulation, setSimulation] = useState(false),
    [clock, setClock] = useState(Date.now());
  const [state, setState] = useState({
    loading: true,
    enabled: false,
    data: [],
    hasMore: false,
    error: "",
  });
  const demo = simulationAllowed && simulation;
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let alive = true,
      timer,
      controller,
      timeout,
      tick = 0;
    setState({
      loading: true,
      enabled: false,
      data: [],
      hasMore: false,
      error: "",
    });
    async function poll() {
      if (document.hidden) {
        timer = setTimeout(poll, 12000);
        return;
      }
      if (demo) {
        setState({
          loading: false,
          enabled: true,
          data: [simulatedBus(tick++)],
          hasMore: false,
          error: "",
        });
        timer = setTimeout(poll, 12000);
        return;
      }
      controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const config = await api.trackingStatus(controller.signal);
        if (!alive) return;
        if (!config.enabled) {
          setState({
            loading: false,
            enabled: false,
            data: [],
            hasMore: false,
            error: "",
          });
          return;
        }
        const result = await api.liveBuses(
          { page, limit: 20, ...(busId ? { busId } : {}) },
          controller.signal,
        );
        if (!Array.isArray(result.data))
          throw new Error("Invalid tracking response");
        if (alive)
          setState({ ...result, enabled: true, loading: false, error: "" });
      } catch (error) {
        if (alive)
          setState({
            loading: false,
            enabled: true,
            data: [],
            hasMore: false,
            error:
              error.name === "AbortError"
                ? "Tracking refresh timed out. No location is being confirmed."
                : error.message,
          });
      } finally {
        clearTimeout(timeout);
      }
      if (alive) timer = setTimeout(poll, 12000);
    }
    const visibility = () => {
      if (!document.hidden) setRetry((value) => value + 1);
    };
    document.addEventListener("visibilitychange", visibility);
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(timeout);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [busId, page, retry, demo]);
  const buses = state.data.map((bus) => visibleBus(bus, clock));
  return (
    <section className="bus-live-section" aria-labelledby="bus-live-title">
      <h2 id="bus-live-title">Live Tracking</h2>
      <p className="muted">
        Authorized bus trips only. Refreshes every 12 seconds while this page is
        visible. Route browsing below works without tracking.
      </p>
      <div className="shop-filters">
        <label>
          Track route
          <select
            value={busId}
            onChange={(e) => {
              setBus(e.target.value);
              setPage(1);
            }}
          >
            {<option value="">All active buses</option>}
            {routes.map((route) => (
              <option key={route._id} value={route._id}>
                Route {route.routeNumber}
                {route.vehicleLabel ? ` · ${route.vehicleLabel}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-soft"
          onClick={() => setRetry((value) => value + 1)}
        >
          Refresh tracking
        </button>
        <Link className="btn btn-soft" to="/driver">
          Driver tracking
        </Link>
      </div>
      {simulationAllowed && (
        <button
          className="btn btn-soft"
          onClick={() => setSimulation((value) => !value)}
        >
          {demo ? "Exit simulation" : "Development simulation"}
        </button>
      )}
      {demo && (
        <p role="status" className="tracking-warning">
          SIMULATED — development fixture near (0,0), not a real bus or campus
          location. Nothing is uploaded.
        </p>
      )}
      {state.loading ? (
        <p role="status">Loading tracking…</p>
      ) : state.error ? (
        <p role="alert">{state.error} Use Refresh tracking to retry.</p>
      ) : !state.enabled ? (
        <p>
          Live tracking is not enabled. Scheduled routes remain available below.
        </p>
      ) : !buses.length ? (
        <p>No authorized active bus trips on this page.</p>
      ) : (
        <>
          {buses.some((bus) => bus.location) ? (
            <BusTrackingMap buses={buses} />
          ) : (
            <p>No current authorized GPS fix to plot.</p>
          )}
          <div className="grid grid-auto">
            {buses.map((bus) => (
              <article className="rich-card" key={bus.tripId}>
                <h3>
                  Route {bus.routeNumber}
                  {bus.vehicleLabel ? ` · ${bus.vehicleLabel}` : ""}
                </h3>
                <p role="status">
                  {bus.trackingStatus === "live"
                    ? "Receiving GPS"
                    : bus.trackingStatus === "stale"
                      ? "Stale — last reported position"
                      : bus.trackingStatus === "simulated"
                        ? "SIMULATED"
                        : "Offline — no current position"}
                </p>
                <p>{bus.routeDescription}</p>
                <p>
                  Last update:{" "}
                  {bus.recordedAt
                    ? new Date(bus.recordedAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      }) + " IST"
                    : "Awaiting GPS"}
                </p>
                {bus.location && (
                  <p>
                    Reported accuracy: ±{Math.round(bus.location.accuracy)} m
                    {bus.location.accuracy > 100 ? " — weak GPS accuracy" : ""}
                  </p>
                )}
                <p>Estimated arrival: unavailable</p>
                <p className="muted">
                  {bus.eta?.reason ||
                    "Verified route and tracking data are insufficient."}
                </p>
                <ul>
                  {bus.stops.map((stop, index) => (
                    <li key={index}>
                      {stop.name}
                      {stop.time ? ` · scheduled ${stop.time}` : ""}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </>
      )}
      {state.enabled && !state.loading && !state.error && (
        <nav className="shop-pagination" aria-label="Live bus pages">
          <button
            className="btn btn-soft"
            disabled={page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous live buses
          </button>
          <span>Page {page}</span>
          <button
            className="btn btn-soft"
            disabled={!state.hasMore}
            onClick={() => setPage((value) => value + 1)}
          >
            Next live buses
          </button>
        </nav>
      )}
    </section>
  );
}
