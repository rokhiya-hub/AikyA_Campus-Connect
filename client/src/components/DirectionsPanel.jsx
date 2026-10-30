import { useEffect, useState } from "react";
import { Compass, X, LocateFixed, Accessibility, MapPinned, ExternalLink } from "lucide-react";
import { distanceMeters, CAMPUS_GATE } from "../lib/useUniverse.js";
import { hasCoordinates, isVerified } from "../lib/campusInfo.js";
import { useGeolocation } from "../lib/useGeolocation.js";

export default function DirectionsPanel({ target, origin: originProp, onLocate, onClose }) {
  const [accessible, setAccessible] = useState(false);
  const geo = useGeolocation();
  useEffect(() => { if (geo.location || geo.error) onLocate?.(geo.location); }, [geo.location, geo.error, onLocate]);
  const origin = geo.location || originProp;
  const reference = hasCoordinates(origin) ? origin : CAMPUS_GATE;
  const distance = distanceMeters(reference, target);
  const mapsHref = hasCoordinates(target) ? `https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}&travelmode=walking${hasCoordinates(origin) ? `&origin=${origin.latitude},${origin.longitude}` : ""}` : null;
  return <div className="map-detail directions-detail" role="region" aria-label={`Directions to ${target.name}`}>
    <button className="icon-btn map-detail-close" onClick={onClose} aria-label="Close directions"><X size={16} /></button>
    <div className="map-detail-head">
      <div className="micro" style={{ marginBottom: 8 }}><Compass size={13} /> Destination reference</div>
      <h2 style={{ fontSize: 22, paddingRight: 30 }}>{target.name}</h2>
      <p className="muted">Destination coordinates {isVerified(target.coordinateVerification) ? "verified" : "unverified"}.</p>
      <div className="badge badge-info"><MapPinned size={12} /> {distance == null ? "Distance unavailable" : `Approximately ${distance} m in a straight line`}</div>
    </div>
    <div className="map-detail-body">
      <p>Verified walking routes and walking ETAs are unavailable. The dashed map line is a reference, not a route to follow.</p>
      {!origin && <p className="muted">Distance uses the existing unverified main-gate reference. External Maps will choose your start location.</p>}
      <button className="btn btn-soft" onClick={geo.locate} disabled={geo.locating}><LocateFixed size={14} /> {geo.locating ? "Locating…" : "Use my location"}</button>
      {geo.error && <p role="alert">{geo.error}</p>}
      {origin && <p role="status">GPS accuracy: {origin.accuracy == null ? "unknown" : `±${Math.round(origin.accuracy)} m`}{origin.accuracy > 50 ? ". Low precision; not suitable for room-level positioning." : ". Outdoor estimate only."} Measured at {origin.measuredAt || "unknown time"}.</p>}
      <button className="btn btn-soft" onClick={() => setAccessible((value) => !value)} aria-pressed={accessible}><Accessibility size={16} /> Accessibility information</button>
      {accessible && <p>No verified ramp, lift or step-free route data is recorded. Confirm accessible entry with campus staff before travelling.</p>}
      <p className="muted">Recorded building: {target.block || target.name}. Floor: {target.floor || "not recorded"}. Indoor routes and room coordinates are not verified.</p>
      {mapsHref ? <a className="btn btn-primary" href={mapsHref} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open directions in Maps</a> : <p role="status">Valid destination coordinates are not available. Use the recorded building/floor details.</p>}
    </div>
  </div>;
}
