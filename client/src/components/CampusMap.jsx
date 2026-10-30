import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  Plus, Minus, Target, Fullscreen, X, Navigation, Star, Search, Loader2,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useUniverse, CAMPUS_CENTER, CAMPUS_GATE, getCampusConfig } from "../lib/useUniverse.js";
import { useTheme } from "../context/ThemeContext.jsx";
import { useFavorites } from "../lib/useFavorites.js";
import { StatusBadge, formatPrice } from "./ui.jsx";
import DirectionsPanel from "./DirectionsPanel.jsx";
import { escapeHtml } from "../lib/escapeHtml.js";
import { useSearchParams } from "react-router-dom";
import { findBuilding, floorKey, roomGroups, hasCoordinates, isVerified } from "../lib/campusInfo.js";
import { useGeolocation } from "../lib/useGeolocation.js";
import DataStatus from "./DataStatus.jsx";
import { stockLabel, ShopSchedule, updatedLabel } from "./ShopDetails.jsx";

const CAT = {
  block: { label: "Blocks", color: "#07579C", icon: "🏢" },
  library: { label: "Library", color: "#2E7CF6", icon: "📚" },
  shop: { label: "Food", color: "#E5A00D", icon: "🍴" },
  hostel: { label: "Hostels", color: "#1E9E5A", icon: "🏠" },
  ground: { label: "Grounds", color: "#58A65C", icon: "🌳" },
  office: { label: "Offices", color: "#8A8FA3", icon: "🏛️" },
  service: { label: "Services", color: "#EC6B4F", icon: "🩺" },
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "block", label: "Blocks" },
  { key: "shop", label: "Food" },
  { key: "hostel", label: "Hostels" },
  { key: "library", label: "Library" },
  { key: "ground", label: "Grounds" },
  { key: "office", label: "Offices" },
  { key: "service", label: "Services" },
];

const TILE_URL = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const BOUNDS = getCampusConfig().bounds;

const ROUTE_COLOR = { light: "#07579C", dark: "#8B9DFF" };
const USER_COLOR = "#1E9E5A";
const GATE_COLOR = "#E9A02B";

/* ---------------------------------------------------------------
   Helpers
   --------------------------------------------------------------- */

// Rounded-rectangle outline of the campus boundary (digital twin footprint).
function campusFootprint() {
  const pad = 0.00042;
  const r = 0.00042;
  const minLat = BOUNDS.minLat - pad, maxLat = BOUNDS.maxLat + pad;
  const minLng = BOUNDS.minLng - pad, maxLng = BOUNDS.maxLng + pad;
  const pts = [];
  const arc = (cx, cy, start, end, steps = 9) => {
    for (let i = 0; i <= steps; i++) {
      const a = start + ((end - start) * i) / steps;
      pts.push([cy + r * Math.sin(a), cx + r * Math.cos(a)]);
    }
  };
  arc(maxLng - r, maxLat - r, Math.PI / 2, 0);
  arc(maxLng - r, minLat + r, 0, -Math.PI / 2);
  arc(minLng + r, minLat + r, -Math.PI / 2, Math.PI);
  arc(minLng + r, maxLat - r, Math.PI, Math.PI / 2);
  return pts;
}

/* ---------------------------------------------------------------
   Building detail panel
   --------------------------------------------------------------- */

export function BuildingDetail({
  poi, faculty, departments, pois = [], onClose, onNavigate, favorite, onToggleFavorite, onVisit,
}) {
  const depts = departments.filter((d) => findBuilding(d, pois)?._id === poi._id);
  const profs = faculty.filter((f) => findBuilding(f, pois)?._id === poi._id);

  const floors = useMemo(() => {
    const entries = [...depts, ...profs];
    const labels = new Map();
    for (const entry of [poi, ...entries]) if (entry.floor) labels.set(floorKey(entry.floor), entry.floor);
    if (entries.some((entry) => !entry.floor)) labels.set("", "Floor not recorded");
    return [...labels.values()].sort((a, b) => floorKey(a).localeCompare(floorKey(b), undefined, { numeric: true }));
  }, [depts, profs]);

  const [floor, setFloor] = useState(floors[0] || "");
  const floorSignature = floors.join("|");
  useEffect(() => {
    setFloor(floors[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poi._id, floorSignature]);
  useEffect(() => {
    onVisit?.(poi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poi._id]);

  const sameFloor = (record) => floor === "Floor not recorded" ? !record.floor : floorKey(record.floor) === floorKey(floor);
  const onFloorProfs = profs.filter((f) => f.cabin && sameFloor(f));
  const onFloorDepts = depts.filter(sameFloor);
  const roomsOnFloor = [
    ...onFloorDepts.flatMap((d) => (d.labs || []).filter((lab) => lab?.trim()).map((lab) => ({ name: lab, kind: "lab", dept: d.name }))),
    ...onFloorProfs.map((f) => ({ name: f.cabin, kind: "cabin", who: f })),
  ];

  return (
    <div className="map-detail" role="region" aria-label={`Details for ${poi.name}`}>
      <button className="icon-btn map-detail-close" onClick={onClose} aria-label="Close building details"><X size={16} /></button>
      <div className="map-detail-head">
        <div style={{ position: "absolute", top: 42, right: 12, display: "flex", gap: 6 }}>
          <button
            className={`icon-btn${favorite ? " active-fav" : ""}`}
            onClick={() => onToggleFavorite(poi)}
            title={favorite ? "Remove from favorites" : "Save to favorites"}
          >
            <Star size={16} style={{ color: favorite ? "var(--warning)" : "var(--text-faint)", fill: favorite ? "var(--warning)" : "none" }} />
          </button>
        </div>
        {poi.type === "shop" ? <span className="badge badge-info">{poi.dataStatus === "verified_listing" ? "Verified listing" : "Demo / unverified listing"}</span> : <StatusBadge status={poi.isOpenNow ? "open" : "closed"} />}
        <h2 style={{ fontSize: 22, margin: "8px 0 4px", paddingRight: 30 }}>{poi.name}</h2>
        <p className="muted">{poi.description || CAT[poi.type]?.label}</p>
        <p className="muted">Coordinates {isVerified(poi.coordinateVerification) ? "verified" : "unverified"}. Allocation {isVerified(poi.allocation?.verification) ? "verified" : "unverified"}.</p>
        <p className="muted">Legacy label associations are provisional; building IDs take precedence.</p>
        <p className="muted" style={{ fontSize: 12 }}>{poi.openHours && <>🕐 {poi.openHours}</>} {poi.block && poi.block !== poi.name && <>· 📍 {poi.block}</>}</p>
      </div>
      <div className="map-detail-body">
        {poi.accessPolicy && (
          <div className="badge badge-restricted" style={{ alignSelf: "flex-start" }}>
            {poi.accessPolicy.note || "Restricted access"}
          </div>
        )}

        {poi.type === "shop" && (
          <>
            <h4>Menu</h4>
            <ShopSchedule shop={poi} />
            <ul className="menu-list">
              {(poi.items || []).map((item) => (
                <li key={item.name}>
                  <span className="menu-name">{item.name}</span>
                  <span>{formatPrice(item.price)} · {stockLabel(item)}<small className="muted"> {updatedLabel(item.stock?.lastUpdatedAt, "Stock")}</small></span>
                </li>
              ))}
            </ul>
          </>
        )}

        {poi.type === "hostel" && (
          <div className="rc-rows">
            <div className="rc-row">🛏️ {poi.totalRooms == null ? "Occupancy details are private" : `${poi.vacantRooms} vacant of ${poi.totalRooms} rooms`}</div>
            <div className="rc-row">🛡️ {poi.warden ? `Warden: ${poi.warden}` : "Warden details are private"}</div>
            {poi.contact && <div className="rc-row">📞 {poi.contact}</div>}
          </div>
        )}

        {(poi.type === "block" || depts.length || profs.length) && (
          <>
            <h4>Recorded floors</h4>
            {!floors.length && <p className="muted">No floor or room information is recorded.</p>}
            <div className="floor-selector">
              {floors.map((f) => (
                <button key={f} className={`floor-btn${f === floor ? " active" : ""}`} onClick={() => setFloor(f)}>
                  {f.replace(" Floor", "")}
                </button>
              ))}
            </div>

            {depts.length > 0 && (
              <>
                <h4>Departments</h4>
                <div className="rc-rows">
                  {depts.map((d) => (
                    <div key={d._id} className="rc-row">
                      <span>🎓</span><span><strong>{d.name}</strong> · {d.hod} · {d.officeHours}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {roomsOnFloor.length > 0 && (
              <>
                <h4>{floor} rooms · list only</h4>
                <p className="muted">Room positions and indoor routes have not been surveyed. This list is not a floor plan.</p>
                <div className="floor-plan">
                  <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
                    {roomsOnFloor.map((r, i) => (
                      <div key={i} className="room-cell" title={r.kind === "lab" ? `${r.name} · ${r.dept}` : `${r.who.name} · ${r.who.designation}`}>
                        <div className="rc-room-no">{r.name}</div>
                        <div className="rc-room-name">{r.kind === "lab" ? "Lab" : "Faculty"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {profs.length > 0 && (
              <>
                <h4>Faculty in this block</h4>
                <div className="rc-rows">
                  {profs.map((f) => (
                    <div key={f._id} className="rc-row">
                      <span>👨‍🏫</span>
                      <span><strong>{f.name}</strong> · {f.designation} · {f.cabin}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <div style={{ marginTop: "auto", display: "flex", gap: 8, paddingTop: 8, flexWrap: "wrap" }}>
          {hasCoordinates(poi) && (
            <a
              className="btn btn-soft"
              href={`https://www.google.com/maps/search/?api=1&query=${poi.latitude},${poi.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              <Navigation size={15} /> Google Maps
            </a>
          )}
          <button className="btn btn-primary" onClick={() => onNavigate(poi)}>
            <Navigation size={15} /> Navigate
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   CampusMap
   --------------------------------------------------------------- */

export default function CampusMap({ mode = "page", onNavigate, height }) {
  const { data, loading, error, refresh } = useUniverse(["pois", "faculty", "departments"]);
  const { theme } = useTheme();
  const { isFavorite, toggleFavorite, recordVisit } = useFavorites();
  const pois = data.pois || [];
  const faculty = data.faculty || [];
  const departments = data.departments || [];

  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const selected = pois.find((poi) => String(poi._id) === selectedId) || null;
  const setSelected = useCallback((poi) => setSelectedId(poi ? String(poi._id) : null), []);
  const [routeTarget, setRouteTarget] = useState(null);
  const [userLoc, setUserLoc] = useState(null);
  const geo = useGeolocation();
  const locating = geo.locating;
  const [mapError, setMapError] = useState(null);
  const [searchParams] = useSearchParams();
  const requestedPoi = searchParams.get("poi");
  const [indoor, setIndoor] = useState(false);
  const [floor, setFloor] = useState("all");

  const shellRef = useRef(null);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const tileLayerRef = useRef(null);
  const poiLayerRef = useRef(null);
  const staticRef = useRef(null);
  const routeRef = useRef(null);
  const directory = useMemo(() => roomGroups(pois, departments, faculty), [pois, departments, faculty]);
  const relatedText = useMemo(() => {
    const index = new Map();
    for (const record of [...departments, ...faculty]) {
      const building = findBuilding(record, pois);
      if (!building) continue;
      index.set(building._id, `${index.get(building._id) || ""} ${[record.name, record.code, record.departmentName, record.cabin, ...(record.labs || [])].filter(Boolean).join(" ")}`.toLowerCase());
    }
    return index;
  }, [pois, departments, faculty]);
  useEffect(() => { if (geo.location || geo.error) setUserLoc(geo.location); }, [geo.location, geo.error]);
  useEffect(() => {
    const place = pois.find((poi) => String(poi._id) === requestedPoi);
    if (place) { setSelected(place); if (hasCoordinates(place)) mapRef.current?.flyTo([place.latitude, place.longitude], 17); }
  }, [requestedPoi, pois, setSelected]);

  /* ---------- init ---------- */
  useEffect(() => {
    const el = shellRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [CAMPUS_CENTER.latitude, CAMPUS_CENTER.longitude],
      zoom: 16,
      minZoom: 14,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: true,
    });
    mapRef.current = map;

    tileLayerRef.current = L.tileLayer(TILE_URL[theme === "dark" ? "dark" : "light"], {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 20,
    }).addTo(map);
    tileLayerRef.current.on("tileerror", () => setMapError("Some map tiles could not load. Check your connection and retry."));

    L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);

    map.on("zoomend", () => {
      el.classList.toggle("zoom-far", map.getZoom() < 15.5);
    });

    // Clicking empty map closes any open panel.
    map.on("click", () => {
      setSelected(null);
      setRouteTarget(null);
    });

    const toggleZoomFar = () => el.classList.toggle("zoom-far", map.getZoom() < 15.5);
    toggleZoomFar();

    let ro;
    try {
      ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(el);
    } catch { /* older browsers */ }
    const resize = () => map.invalidateSize();
    document.addEventListener("fullscreenchange", resize);

    return () => {
      ro?.disconnect();
      document.removeEventListener("fullscreenchange", resize);
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      poiLayerRef.current = null;
      staticRef.current = null;
      routeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    tileLayerRef.current?.setUrl(TILE_URL[theme === "dark" ? "dark" : "light"]);
  }, [theme]);

  /* ---------- static overlay: footprint, road, gate ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (staticRef.current) {
      map.removeLayer(staticRef.current);
      staticRef.current = null;
    }

    const layer = L.layerGroup();

    const dark = theme === "dark";
    L.polygon(campusFootprint(), {
      color: dark ? "#8B9DFF" : "#07579C",
      weight: 1.6,
      dashArray: "4 7",
      lineCap: "round",
      opacity: dark ? 0.55 : 0.45,
      fillColor: dark ? "#151F36" : "#07579C",
      fillOpacity: dark ? 0.10 : 0.05,
      interactive: false,
    }).addTo(layer);

    const roadLat = CAMPUS_GATE.latitude - 0.00038;
    L.polyline(
      [
        [roadLat, BOUNDS.minLng + 0.0009],
        [roadLat, BOUNDS.maxLng - 0.0009],
      ],
      {
        color: dark ? "#C9A24B" : "#C9973F",
        weight: 4,
        opacity: dark ? 0.4 : 0.5,
      }
    ).addTo(layer);
    L.polyline(
      [
        [roadLat, BOUNDS.minLng + 0.0009],
        [roadLat, BOUNDS.maxLng - 0.0009],
      ],
      {
        color: dark ? "#F0CD83" : "#E9C072",
        weight: 1.2,
        opacity: 0.85,
        dashArray: "1 10",
      }
    ).addTo(layer);

    const gateIcon = L.divIcon({
      className: "map-gate-shell",
      html: `<div class="map-gate"><span class="map-gate-icon"></span><span class="map-gate-label">Gate reference · unverified</span></div>`,
      iconSize: [0, 0],
    });
    L.marker([CAMPUS_GATE.latitude, CAMPUS_GATE.longitude], {
      icon: gateIcon, zIndexOffset: 900, interactive: false,
    }).addTo(layer);

    staticRef.current = layer;
    layer.addTo(map);
  }, [theme]);

  /* ---------- POI + indoor markers ---------- */
  const visible = useCallback(
    (poi) => {
      const catOk = filter === "all" || poi.type === filter;
      const qq = q.trim().toLowerCase();
      const searchOk =
        !qq ||
        (poi.name || "").toLowerCase().includes(qq) ||
        (poi.block || "").toLowerCase().includes(qq) ||
        (poi.description || "").toLowerCase().includes(qq) ||
        (relatedText.get(poi._id) || "").includes(qq);
      return catOk && searchOk;
    },
    [filter, q, relatedText]
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (poiLayerRef.current) {
      map.removeLayer(poiLayerRef.current);
      poiLayerRef.current = null;
    }

    const layer = L.layerGroup();

    // Building / POI markers.
    pois.forEach((poi) => {
      if (!hasCoordinates(poi)) return;
      if (!visible(poi)) return;
      const meta = CAT[poi.type] || CAT.office;
      const isSel = selected?._id === poi._id;

      const icon = L.divIcon({
        className: "map-marker-shell",
        html: `
          <div class="map-marker${isSel ? " selected" : ""}" style="--dot:${meta.color};--icon:${meta.icon}">
            <span class="marker-pin"><span class="marker-pin-dot">${meta.icon}</span></span>
            <span class="marker-label"><i class="ml-dot" style="background:${meta.color};box-shadow:0 0 6px ${meta.color}"></i>${escapeHtml(poi.name)}</span>
          </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = L.marker([poi.latitude, poi.longitude], {
        icon, title: `${poi.name} · coordinates ${isVerified(poi.coordinateVerification) ? "verified" : "unverified"}`, zIndexOffset: isSel ? 1000 : 0,
      });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        setRouteTarget(null);
        setSelected(poi);
      });
      marker.bindTooltip(`${meta.icon} ${escapeHtml(poi.name)}`, {
        className: "map-tip", direction: "top", offset: [0, -40], opacity: 1,
      });
      marker.addTo(layer);
    });

    layer.addTo(map);
    poiLayerRef.current = layer;
  }, [pois, visible, selected, setSelected]);

  /* ---------- user location + route drawing ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (routeRef.current) {
      map.removeLayer(routeRef.current);
      routeRef.current = null;
    }
    const dark = theme === "dark";
    const routeColor = ROUTE_COLOR[dark ? "dark" : "light"];

    const dest =
      hasCoordinates(routeTarget)
        ? L.latLng(routeTarget.latitude, routeTarget.longitude)
        : null;
    const orig =
      hasCoordinates(userLoc)
        ? L.latLng(userLoc.latitude, userLoc.longitude)
        : dest
          ? L.latLng(CAMPUS_GATE.latitude, CAMPUS_GATE.longitude)
          : null;

    if (!orig && !dest) return;
    const layer = L.layerGroup();

    // "You are here" marker.
    if (hasCoordinates(userLoc)) {
      if (userLoc.accuracy) {
        L.circle([userLoc.latitude, userLoc.longitude], {
          radius: userLoc.accuracy,
          color: USER_COLOR, weight: 1.2, opacity: 0.55,
          fillColor: USER_COLOR, fillOpacity: 0.08,
        }).addTo(layer);
      }
      L.marker([userLoc.latitude, userLoc.longitude], {
        icon: L.divIcon({
          className: "route-shell",
          html: `<div class="map-route-dot"></div>`,
          iconSize: [0, 0],
        }),
        zIndexOffset: 950,
      }).addTo(layer);
    }

    // Route polyline + destination marker.
    if (orig && dest) {
      L.polyline([orig, dest], {
        color: routeColor,
        weight: 3.5,
        opacity: 0.85,
        dashArray: "2 9",
        lineCap: "round",
      }).addTo(layer);
      L.circleMarker(orig, {
        radius: 5, color: routeColor, weight: 2,
        fillColor: routeColor, fillOpacity: 0.9,
      }).addTo(layer);
      L.circleMarker(dest, {
        radius: 8, color: "#fff", weight: 2,
        fillColor: routeColor, fillOpacity: 0.9,
      }).addTo(layer);
    }

    layer.addTo(map);
    routeRef.current = layer;

    if (orig && dest) {
      map.fitBounds(L.latLngBounds([orig, dest]).pad(0.32), { animate: true, maxZoom: 18 });
    }
  }, [routeTarget, userLoc, theme]);

  /* ---------- close panels with Escape ---------- */
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape") return;
      setSelected(null);
      setRouteTarget((r) => r && null);
      setIndoor(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- panel / container resize handling ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [selected, routeTarget]);

  /* ---------- controls ---------- */
  const zoomBy = useCallback((dir) => mapRef.current?.zoomIn(dir), []);

  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([CAMPUS_CENTER.latitude, CAMPUS_CENTER.longitude], 16);
  };

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (el.requestFullscreen) await el.requestFullscreen();
      else setMapError("Fullscreen is not supported by this browser.");
    } catch { setMapError("Fullscreen was unavailable. You can continue using the map here."); }
  };

  const setMyLocation = geo.locate;

  const searchMatches = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return [];
    return pois
      .filter((p) =>
        (p.name || "").toLowerCase().includes(qq) ||
        (p.block || "").toLowerCase().includes(qq) ||
        (p.description || "").toLowerCase().includes(qq) ||
        (relatedText.get(p._id) || "").includes(qq) ||
        (CAT[p.type]?.label || "").toLowerCase().includes(qq)
      )
      .slice(0, 8);
  }, [q, pois, relatedText]);

  const pickSearch = (poi) => {
    setQ("");
    setFilter("all");
    setSelected(poi);
    setRouteTarget(null);
    if (hasCoordinates(poi)) mapRef.current?.flyTo([poi.latitude, poi.longitude], 17);
    else setMapError("Coordinates are unavailable for this place. Recorded details are still shown.");
  };

  const counts = useMemo(() => {
    const c = { all: pois.length };
    Object.keys(CAT).forEach((k) => (c[k] = pois.filter((p) => p.type === k).length));
    return c;
  }, [pois]);

  const floorsAvailable = useMemo(() => {
    return [...new Set([...departments, ...faculty].map((record) => record.floor).filter(Boolean))].sort((a, b) => floorKey(a).localeCompare(floorKey(b), undefined, { numeric: true }));
  }, [departments, faculty]);

  const mapHeight = height || (mode === "dashboard" ? 340 : undefined);
  const legendRows = Object.entries(CAT).filter(([k]) =>
    mode === "dashboard"
      ? ["block", "shop", "hostel", "library"].includes(k)
      : pois.some((p) => p.type === k)
  );

  return (
    <div ref={containerRef} className="map-shell" style={mapHeight ? { height: mapHeight } : { height: "min(76vh, 720px)" }}>
      <div className="map-notices">
        <DataStatus loading={loading} error={error} retry={refresh} />
        <p>Coordinates and prototype boundary/road/gate overlays are unverified unless explicitly confirmed. Dashed lines show straight-line references, not walking routes.</p>
        {geo.error && <p role="alert">{geo.error}</p>}
        {userLoc && <p role="status">GPS accuracy: {userLoc.accuracy == null ? "unknown" : `±${Math.round(userLoc.accuracy)} m`}{userLoc.accuracy > 50 ? " · Low precision; do not use for room-level positioning." : " · Outdoor estimate only."} Measured at {userLoc.measuredAt}.</p>}
        {mapError && <div role="alert">{mapError} <button className="btn btn-soft" onClick={() => { setMapError(null); tileLayerRef.current?.redraw(); }}>Retry map tiles</button></div>}
        {!loading && !error && !pois.length && <p>No places have been added yet.</p>}
      </div>
      {mode === "page" && (
        <div className="map-toolbar">
          <div className="map-search-wrap">
            <div className="search-box" style={{ flex: 1 }}>
              <span className="search-icon"><Search size={16} /></span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchMatches[0] && pickSearch(searchMatches[0])}
                placeholder="Search places, faculty, cabins or labs…"
                aria-label="Search on map"
              />
            </div>
            {searchMatches.length > 0 && (
              <div className="map-search-results">
                {searchMatches.map((p) => (
                  <button key={p._id} className="map-search-result" onClick={() => pickSearch(p)}>
                    <span className="msr-ic" style={{ background: (CAT[p.type]?.color || "#888") + "22" }}>{CAT[p.type]?.icon || "📍"}</span>
                    <span>
                      <strong style={{ fontSize: 13, display: "block" }}>{p.name}</strong>
                      <span className="muted" style={{ fontSize: 11.5 }}>{CAT[p.type]?.label}{p.openHours ? ` · ${p.openHours}` : ""}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {q.trim() && !searchMatches.length && <div className="map-search-results" role="status">No places matched your search.</div>}
          </div>

          <div className="map-actions">
            <button
              className={`icon-btn${locating ? " locating" : ""}`}
              onClick={setMyLocation}
              title="Show my location"
              aria-label="My location"
              disabled={locating}
            >
              {locating ? <Loader2 size={16} className="spinning" /> : <Target size={16} />}
            </button>
            <button className="icon-btn" onClick={toggleFullscreen} title="Fullscreen" aria-label="Fullscreen">
              <Fullscreen size={16} />
            </button>
            <button
              className={`map-filter${indoor ? " active" : ""}`}
              onClick={() => { setIndoor((v) => !v); setSelected(null); setRouteTarget(null); }}
              aria-pressed={indoor}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              🚪 Rooms
            </button>
          </div>

          <div className="map-filters" style={{ width: "100%" }}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`map-filter${filter === f.key ? " active" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}<span className="filter-count">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {indoor && (
            <div className="map-floors">
              <span className="micro" style={{ opacity: 0.7 }}>Level</span>
              <button className={`floor-chip${floor === "all" ? " active" : ""}`} onClick={() => setFloor("all")}>All</button>
              {floorsAvailable.map((fi) => (
                <button key={fi} className={`floor-chip${floor === fi ? " active" : ""}`} onClick={() => setFloor(fi)}>
                  {fi}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        ref={shellRef}
        className="leaflet-shell"
        style={{ width: "100%", height: "100%", position: "absolute", inset: 0, zIndex: 0 }}
      />

      {mode === "page" && (
        <>
          <div className="map-controls">
            <button className="icon-btn" onClick={() => zoomBy(1)} title="Zoom in"><Plus size={17} /></button>
            <button className="icon-btn" onClick={() => zoomBy(-1)} title="Zoom out"><Minus size={17} /></button>
            <button className="icon-btn" onClick={resetView} title="Recenter campus"><Target size={16} /></button>
          </div>
          <div className="map-legend">
            <div className="map-legend-head">
              <span>SURAMPALEM</span>
              <span className="map-live">REFERENCE MAP</span>
            </div>
            {legendRows.map(([k, m]) => (
              <div key={k} className="legend-row">
                <span className="legend-dot" style={{ background: m.color }} />
                {m.label}
                <span className="legend-count">{counts[k]}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {mode === "dashboard" && (
        <div className="map-legend" style={{ left: 12, bottom: 12 }}>
          <div className="legend-row">
            <span className="legend-dot" style={{ background: "var(--accent)" }} />
            Campus markers
          </div>
          <div className="legend-row">
            <span className="legend-dot" style={{ background: GATE_COLOR }} />
            Tap a marker for details
          </div>
        </div>
      )}

      {selected && (
        <BuildingDetail
          poi={selected}
          faculty={faculty}
          departments={departments}
          pois={pois}
          favorite={isFavorite(selected._id)}
          onToggleFavorite={toggleFavorite}
          onVisit={recordVisit}
          onClose={() => setSelected(null)}
          onNavigate={(poi) => {
            if (mode === "page") {
              setSelected(null);
              setRouteTarget(poi);
            } else {
              onNavigate?.(poi);
            }
          }}
        />
      )}

      {indoor && !selected && !routeTarget && <div className="map-detail" role="region" aria-label="Recorded rooms">
        <button className="icon-btn map-detail-close" aria-label="Close room directory" onClick={() => setIndoor(false)}><X size={16} /></button>
        <div className="map-detail-head"><h2>Recorded rooms</h2><p className="muted">Directory only. Indoor coordinates and routes are not verified.</p></div>
        <div className="map-detail-body">{directory.map(({ building, records }) => <section key={building._id}>
          <button className="btn btn-soft" onClick={() => setSelected(building)}>{building.name}</button>
          <ul>{records.filter((record) => floor === "all" || floorKey(record.floor) === floorKey(floor)).map((record, index) => <li key={index}>{record.name} · {record.floor || "Floor unknown"} · {record.context}</li>)}</ul>
        </section>)}{!directory.length && <p>No linked floor/room records are available.</p>}</div>
      </div>}

      {routeTarget && (
        <DirectionsPanel
          target={routeTarget}
          origin={userLoc}
          onLocate={setUserLoc}
          onClose={() => setRouteTarget(null)}
        />
      )}
    </div>
  );
}
