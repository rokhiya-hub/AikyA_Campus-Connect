import { useCallback, useEffect, useRef, useState } from "react";
import { hasCoordinates } from "./campusInfo.js";
export function locationError(error) {
  return ({ 1: "Location permission was denied. Enable it in your browser settings and retry.", 2: "Your location is unavailable. Try again outdoors or choose a place on the map.", 3: "Location request timed out. Please retry." })[error?.code] || "Could not obtain a valid location. Please retry.";
}
export function useGeolocation() {
  const [state, setState] = useState({ location: null, locating: false, error: null });
  const active = useRef(true), generation = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  const locate = useCallback(() => {
    const request = ++generation.current;
    if (!navigator.geolocation || window.isSecureContext === false) {
      setState({ location: null, locating: false, error: "Location requires a supported browser on HTTPS or localhost." });
      return;
    }
    setState((previous) => ({ ...previous, locating: true, error: null }));
    const finish = (next) => { if (active.current && request === generation.current) setState(next); };
    try { navigator.geolocation.getCurrentPosition((position) => {
      const timestamp = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();
      if (timestamp < 0 || timestamp > Date.now() + 60000 || !Number.isFinite(new Date(timestamp).getTime())) {
        finish({ location: null, locating: false, error: "The location timestamp is invalid. Please retry." });
        return;
      }
      const location = { latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracy: Number.isFinite(position.coords.accuracy) && position.coords.accuracy >= 0 ? position.coords.accuracy : null,
        measuredAt: new Date(timestamp).toISOString(), name: "Your location" };
      if (!hasCoordinates(location) || Date.now() - new Date(location.measuredAt).getTime() > 120000) {
        finish({ location: null, locating: false, error: "The location result is invalid or out of date. Please retry." });
      } else finish({ location, locating: false, error: null });
    }, (error) => finish({ location: null, locating: false, error: locationError(error) }), { enableHighAccuracy: true, timeout: 8000, maximumAge: 20000 }); }
    catch { finish({ location: null, locating: false, error: locationError() }); }
  }, []);
  return { ...state, locate };
}
