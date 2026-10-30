import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
export default function DriverTracking() {
  const [deviceId, setDevice] = useState(""),
    [secret, setSecret] = useState(""),
    [auth, setAuth] = useState(null),
    [trip, setTrip] = useState(null);
  const [consent, setConsent] = useState(false),
    [running, setRunning] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [lastUpdate, setLastUpdate] = useState(null);
  const sessionRef = useRef(null),
    tripRef = useRef(null),
    watch = useRef(null),
    timer = useRef(null),
    fix = useRef(null),
    uploading = useRef(false),
    uploadAbort = useRef(null),
    lastSent = useRef(null),
    lastAttempt = useRef(0),
    leaseDeadline = useRef(null),
    intent = useRef(0),
    alive = useRef(true);
  const clearLocal = useCallback(() => {
    intent.current += 1;
    if (watch.current !== null)
      navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
    clearInterval(timer.current);
    timer.current = null;
    uploadAbort.current?.abort();
    fix.current = null;
    lastSent.current = null;
    lastAttempt.current = 0;
    leaseDeadline.current = null;
  }, []);
  const stop = useCallback(
    async (reason = "Location sharing stopped on this device.") => {
      clearLocal();
      setRunning(false);
      setConsent(false);
      setStatus(reason);
      const active = tripRef.current,
        session = sessionRef.current;
      if (active && session) {
        try {
          await api.endBusTrip(active._id, session.token, true);
          tripRef.current = null;
          if (alive.current) setTrip(null);
        } catch {
          if (alive.current)
            setStatus(
              `${reason} Server trip end is unconfirmed. No more GPS will be sent. Retry Stop; the location becomes offline within 90 seconds of the last accepted fix.`,
            );
        }
      }
    },
    [clearLocal],
  );
  useEffect(() => {
    if (!running || !trip) return;
    const check = setInterval(() => {
      if (
        Date.now() >=
        Math.min(
          new Date(trip.expiresAt).getTime(),
          leaseDeadline.current || Infinity,
        )
      )
        stop(
          "GPS authorization expired without a fresh accepted fix. Sharing stopped; end this trip before starting again with consent.",
        );
    }, 1000);
    return () => clearInterval(check);
  }, [running, trip, stop]);
  useEffect(() => {
    alive.current = true;
    const hidden = () => {
      if (document.hidden) {
        intent.current += 1;
        if (tripRef.current)
          stop(
            "Tracking stopped because the browser left the foreground. Start again with consent to resume.",
          );
      }
    };
    const leaving = () => {
      clearLocal();
      if (alive.current) {
        setRunning(false);
        setConsent(false);
        setStatus(
          "This page stopped local GPS sharing. End the previous trip before starting again.",
        );
      }
      if (tripRef.current && sessionRef.current)
        api
          .endBusTrip(tripRef.current._id, sessionRef.current.token, true)
          .catch(() => {});
    };
    const offline = () => {
      if (tripRef.current)
        stop(
          "Connectivity lost; local tracking stopped and old fixes were discarded.",
        );
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    window.addEventListener("offline", offline);
    return () => {
      alive.current = false;
      leaving();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("offline", offline);
    };
  }, [stop, clearLocal]);
  useEffect(() => {
    if (!auth) return;
    const refresh = setTimeout(
      async () => {
        try {
          const result = await api.refreshDriverSession(
            sessionRef.current.token,
          );
          if (alive.current) {
            sessionRef.current = result;
            setAuth(result);
          }
        } catch {
          if (alive.current) {
            await stop(
              "Device session expired or could not be renewed. Sign in again.",
            );
            sessionRef.current = null;
            setAuth(null);
          }
        }
      },
      Math.max(1000, new Date(auth.expiresAt).getTime() - Date.now() - 60000),
    );
    return () => clearTimeout(refresh);
  }, [auth, stop]);
  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const result = await api.driverSession({
        deviceId: deviceId.trim(),
        secret: secret.trim(),
      });
      const current = await api.driverCurrentTrip(result.token);
      sessionRef.current = result;
      setAuth(result);
      setSecret("");
      tripRef.current = current.trip;
      setTrip(current.trip);
      setStatus(
        current.trip
          ? "A previous trip exists. End it before starting a new sharing session; GPS has not started."
          : "Device authorized. GPS is off until you explicitly start a trip.",
      );
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function sendFix(generation) {
    if (generation !== intent.current) return;
    if (
      uploading.current ||
      !fix.current ||
      !tripRef.current ||
      !sessionRef.current
    )
      return;
    if (Date.now() - lastAttempt.current < 12000) return;
    const sample = fix.current;
    if (
      sample.recordedAt === lastSent.current ||
      Date.now() - new Date(sample.recordedAt).getTime() > 30000
    )
      return;
    uploading.current = true;
    lastAttempt.current = Date.now();
    uploadAbort.current = new AbortController();
    const timeout = setTimeout(() => uploadAbort.current?.abort(), 10000);
    try {
      const result = await api.sendBusLocation(
        tripRef.current._id,
        sample,
        sessionRef.current.token,
        uploadAbort.current.signal,
      );
      if (generation !== intent.current) return;
      lastSent.current = sample.recordedAt;
      leaseDeadline.current = result.leaseExpiresAt
        ? new Date(result.leaseExpiresAt).getTime()
        : new Date(result.receivedAt).getTime() + 90000;
      if (alive.current && tripRef.current) {
        setLastUpdate(result.receivedAt);
        setStatus(
          `GPS report accepted. Accuracy ±${Math.round(sample.accuracy)} m. Keep this page visible.`,
        );
      }
    } catch (error) {
      fix.current = null;
      if (!alive.current || generation !== intent.current) return;
      if (!error.status || error.status >= 500)
        await stop(
          "The server connection could not confirm this GPS update. Local sharing stopped; no fixes are queued. Retry ending the trip, then start again with consent.",
        );
      else if ([401, 403, 409].includes(error.status))
        await stop(`Tracking authorization stopped: ${error.message}`);
      else
        setStatus(
          `GPS was not accepted: ${error.message}. Old fixes are discarded; waiting for a new fix.`,
        );
    } finally {
      clearTimeout(timeout);
      uploading.current = false;
    }
  }
  async function start() {
    if (!consent || tripRef.current || busy) return;
    if (!window.isSecureContext) {
      setStatus(
        "GPS sharing requires HTTPS or localhost. GPS has not started.",
      );
      return;
    }
    if (!navigator.geolocation) {
      setStatus(
        "This device does not support browser geolocation. GPS has not started.",
      );
      return;
    }
    if (document.hidden) {
      setStatus("Keep this page in the foreground before starting.");
      return;
    }
    setBusy(true);
    setStatus("Starting an authorized trip; GPS permission will be requested.");
    const requested = ++intent.current,
      session = sessionRef.current;
    try {
      const active = await api.startBusTrip(session.token);
      if (
        requested !== intent.current ||
        !alive.current ||
        document.hidden ||
        sessionRef.current !== session
      ) {
        try {
          await api.endBusTrip(active._id, session.token, true);
        } catch {}
        return;
      }
      // Permission to share is checked again after the request: the page may have hidden while starting.
      tripRef.current = active;
      leaseDeadline.current = active.leaseExpiresAt
        ? new Date(active.leaseExpiresAt).getTime()
        : Date.now() + 90000;
      setTrip(active);
      if (document.hidden || !alive.current) {
        await stop("Start cancelled because the page left the foreground.");
        return;
      }
      setRunning(true);
      setLastUpdate(null);
      watch.current = navigator.geolocation.watchPosition(
        (position) => {
          if (
            requested !== intent.current ||
            !tripRef.current ||
            document.hidden
          )
            return;
          if (
            !Number.isFinite(position.coords.accuracy) ||
            position.coords.accuracy > 200
          ) {
            fix.current = null;
            setStatus(
              "GPS accuracy is too weak (over 200 m); no location is uploaded. Move to a safe open area.",
            );
            return;
          }
          fix.current = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            recordedAt: new Date(position.timestamp).toISOString(),
          };
          sendFix(requested);
        },
        (error) => {
          if (requested !== intent.current) return;
          fix.current = null;
          if (error.code === 1)
            stop(
              "GPS permission denied. Sharing stopped. Allow location in browser settings only if you choose to share.",
            );
          else
            setStatus(
              "A fresh GPS fix could not be obtained. No cached location is uploaded; the trip will become offline without updates.",
            );
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
      timer.current = setInterval(() => sendFix(requested), 12000);
    } catch (error) {
      clearLocal();
      setRunning(false);
      setStatus(error.message);
      // A lost start response can still have created a trip. Recover metadata, never resume GPS automatically.
      try {
        const current = await api.driverCurrentTrip(sessionRef.current.token);
        tripRef.current = current.trip;
        setTrip(current.trip);
      } catch {}
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function signOut() {
    await stop();
    sessionRef.current = null;
    setAuth(null);
    setSecret("");
  }
  return (
    <div>
      <PageHeader
        kicker="Authorized devices"
        title="Driver tracking"
        sub="Use only an administrator-authorized device attached to the assigned bus. Never use this to track a person."
      />
      <p>
        <Link to="/buses">Back to bus routes and tracking</Link>
      </p>
      <div className="tracking-warning">
        <p>
          Sharing uses high-accuracy GPS and battery power. Keep the device
          safely mounted, charged and online. Operate these controls while
          parked.
        </p>
        <p>
          Browser tracking is a foreground fallback. Switching apps, locking the
          screen, closing the page or losing connectivity stops local sharing.
          Closing the browser may prevent the final stop request from reaching
          the server; the 90-second GPS lease limits visibility. Reliable
          production tracking needs a dedicated GPS unit or a native app with
          explicit background-location permissions.
        </p>
      </div>
      {!auth ? (
        <form className="rich-card shop-form" onSubmit={signIn}>
          <h2>Authorize this driver device</h2>
          <label>
            Device ID
            <input
              required
              maxLength={24}
              pattern="[a-fA-F0-9]{24}"
              value={deviceId}
              onChange={(e) => setDevice(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Device secret
            <input
              required
              type="password"
              maxLength={64}
              minLength={64}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
            />
          </label>
          <p>
            Credentials are kept in memory for this page session, never in local
            storage.
          </p>
          <button className="btn btn-primary" disabled={busy}>
            Authorize device
          </button>
        </form>
      ) : (
        <section className="rich-card shop-form">
          <h2>Assigned bus device</h2>
          <p>Bus ID: {auth.busId}</p>
          <p>GPS sharing: {running ? "ON — foreground only" : "OFF"}</p>
          {trip && (
            <p>
              Trip ends no later than{" "}
              {new Date(trip.expiresAt).toLocaleString()}. End this trip before
              starting another.
            </p>
          )}
          <label className="shop-check">
            <input
              type="checkbox"
              checked={consent}
              disabled={running || !!trip}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I am operating the assigned bus, consent to share this device’s GPS
            with students during this trip, and will stop sharing when the trip
            ends.
          </label>
          <div className="shop-pagination">
            <button
              className="btn btn-primary"
              disabled={!consent || !!trip || busy}
              onClick={start}
            >
              Start trip and share GPS
            </button>
            <button
              className="btn btn-soft"
              disabled={!trip}
              onClick={() => stop()}
            >
              Stop sharing and end trip
            </button>
            <button className="btn btn-soft" onClick={signOut}>
              Forget device session
            </button>
          </div>
          {lastUpdate && (
            <p>Last accepted update: {new Date(lastUpdate).toLocaleString()}</p>
          )}
        </section>
      )}
      <p role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
