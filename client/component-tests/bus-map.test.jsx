import React from "react";
import { render, cleanup } from "@testing-library/react";
import L from "leaflet";
import BusTrackingMap from "../src/components/BusTrackingMap.jsx";
jest.mock("../src/context/ThemeContext.jsx", () => ({
  useTheme: () => ({ theme: "dark" }),
}));
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});
test("Leaflet updates authorized bus markers, escapes labels and removes ended/offline positions", () => {
  jest.spyOn(L.Map.prototype, "fitBounds");
  const marker = jest.spyOn(L, "marker");
  const bus = {
    busId: "synthetic",
    routeNumber: '<img src=x onerror="alert(1)">',
    trackingStatus: "live",
    location: { latitude: 17, longitude: 82, accuracy: 15 },
  };
  const view = render(
    <React.StrictMode>
      <BusTrackingMap buses={[bus]} />
    </React.StrictMode>,
  );
  expect(document.querySelectorAll(".bus-tracking-marker").length).toBe(1);
  const initialCount = marker.mock.calls.length;
  const instance = marker.mock.results.at(-1).value;
  expect(instance.getTooltip().getContent().querySelector("img")).toBeNull();
  view.rerender(
    <React.StrictMode>
      <BusTrackingMap
        buses={[{ ...bus, location: { ...bus.location, latitude: 17.001 } }]}
      />
    </React.StrictMode>,
  );
  expect(marker).toHaveBeenCalledTimes(initialCount);
  expect(instance.getLatLng().lat).toBe(17.001);
  view.rerender(
    <React.StrictMode>
      <BusTrackingMap buses={[{ ...bus, location: null }]} />
    </React.StrictMode>,
  );
  expect(document.querySelectorAll(".bus-tracking-marker").length).toBe(0);
});
