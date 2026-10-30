import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme } from "../context/ThemeContext.jsx";
export default function BusTrackingMap({ buses }) {
  const host = useRef(null),
    map = useRef(null),
    layers = useRef(new Map()),
    previous = useRef("");
  const theme = useTheme()?.theme || "light";
  useEffect(() => {
    previous.current = "";
    map.current = L.map(host.current, { scrollWheelZoom: false });
    return () => {
      map.current.remove();
      map.current = null;
      layers.current.clear();
    };
  }, []);
  useEffect(() => {
    const tile = L.tileLayer(
      theme === "dark"
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      },
    ).addTo(map.current);
    return () => tile.remove();
  }, [theme]);
  useEffect(() => {
    const active = new Set();
    const points = [];
    for (const bus of buses) {
      const point = bus.location;
      if (
        !point ||
        !Number.isFinite(point.latitude) ||
        !Number.isFinite(point.longitude) ||
        Math.abs(point.latitude) > 90 ||
        Math.abs(point.longitude) > 180
      )
        continue;
      active.add(bus.busId);
      const coordinates = [point.latitude, point.longitude];
      points.push(coordinates);
      const text = document.createElement("span");
      text.textContent = `Route ${bus.routeNumber} — ${bus.trackingStatus}; accuracy ±${Math.round(point.accuracy)} m`;
      const existing = layers.current.get(bus.busId);
      if (existing) {
        existing.marker.setLatLng(coordinates).setTooltipContent(text);
        existing.circle.setLatLng(coordinates).setRadius(point.accuracy);
      } else {
        const marker = L.marker(coordinates, {
          title: `Bus route ${bus.routeNumber}`,
          icon: L.divIcon({
            className: "bus-tracking-marker",
            html: "<span aria-hidden='true'>BUS</span>",
            iconSize: [44, 34],
            iconAnchor: [22, 17],
          }),
        })
          .bindTooltip(text)
          .addTo(map.current);
        const circle = L.circle(coordinates, {
          radius: point.accuracy,
          color: "#16A8E8",
          weight: 1,
          fillOpacity: 0.1,
        }).addTo(map.current);
        layers.current.set(bus.busId, { marker, circle });
      }
    }
    for (const [key, value] of layers.current)
      if (!active.has(key)) {
        value.marker.remove();
        value.circle.remove();
        layers.current.delete(key);
      }
    const signature = [...active].sort().join(",");
    if (points.length && signature !== previous.current)
      map.current.fitBounds(L.latLngBounds(points), {
        maxZoom: 16,
        padding: [30, 30],
      });
    previous.current = signature;
  }, [buses]);
  return (
    <div
      className="bus-live-map"
      ref={host}
      role="region"
      aria-label="Authorized bus locations map"
    />
  );
}
