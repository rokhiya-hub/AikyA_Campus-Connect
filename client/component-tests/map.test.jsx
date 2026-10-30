import React from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import L from "leaflet";
import CampusMap, { BuildingDetail } from "../src/components/CampusMap.jsx";
let mockTheme = "light", mockState;
jest.mock("../src/lib/useUniverse.js", () => {
  const actual = jest.requireActual("../src/lib/useUniverse.js");
  return { ...actual, useUniverse: () => mockState };
});
jest.mock("../src/api/client.js", () => ({ api: {} }));
jest.mock("../src/context/ThemeContext.jsx", () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock("../src/lib/useFavorites.js", () => ({ useFavorites: () => ({ isFavorite: () => false, toggleFavorite() {}, recordVisit() {} }) }));
const building = { _id: "building-a", type: "block", name: "Synthetic North Block", latitude: 17.09, longitude: 82.067 };
const other = { _id: "building-b", type: "block", name: "Synthetic North Annex", latitude: 17.091, longitude: 82.068 };
beforeEach(() => {
  mockTheme = "light";
  mockState = { data: { pois: [building, other, { _id: "bad", name: "Unlocated place", type: "block", latitude: 120, longitude: 0 }],
    departments: [{ _id: "dept", name: "Synthetic department", buildingId: building._id, block: "Old label", floor: "4th Floor", labs: ["Recorded lab"] }],
    faculty: [{ _id: "faculty", name: "Synthetic Lecturer", buildingId: building._id, block: "Old label", floor: "Ground Floor", cabin: "G101" }] }, loading: false, error: "", refresh: jest.fn() };
  jest.spyOn(L.Map.prototype, "flyTo").mockReturnThis();
  jest.spyOn(L.Map.prototype, "fitBounds").mockReturnThis();
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
const mount = (entry = "/map") => render(<MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><CampusMap /></MemoryRouter>);
test("real Leaflet markers select the correct stable building, support Escape and ignore invalid coordinates", () => {
  const marker = jest.spyOn(L, "marker");
  mount();
  const icon = document.querySelector('[title="Synthetic North Block · coordinates unverified"]');
  expect(icon).not.toBeNull();
  fireEvent.click(icon);
  const panel = screen.getByRole("region", { name: "Details for Synthetic North Block" });
  expect(panel.textContent).toContain("Synthetic department");
  fireEvent.click(screen.getByRole("button", { name: "4th" }));
  expect(panel.textContent).toContain("Recorded lab");
  expect(panel.textContent).toContain("not a floor plan");
  expect(marker.mock.calls.some(([coords]) => coords[0] === 120)).toBe(false);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("region", { name: "Details for Synthetic North Block" })).toBeNull();
});
test("rooms use a list without creating fabricated indoor marker positions", () => {
  const marker = jest.spyOn(L, "marker");
  mount();
  const initial = marker.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: /Rooms/ }));
  expect(screen.getByRole("region", { name: "Recorded rooms" }).textContent).toContain("G101");
  expect(marker.mock.calls.length).toBe(initial);
  expect(document.querySelector(".indoor-marker")).toBeNull();
});
test("map search, URL IDs, tile errors and light/dark tile updates preserve Leaflet", () => {
  const setUrl = jest.spyOn(L.TileLayer.prototype, "setUrl");
  const tiles = jest.spyOn(L, "tileLayer");
  const redraw = jest.spyOn(L.TileLayer.prototype, "redraw");
  const view = mount("/map?poi=building-b");
  expect(screen.getByRole("region", { name: "Details for Synthetic North Annex" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close building details" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search on map" }), { target: { value: "North Block" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Search on map" }), { key: "Enter" });
  expect(screen.getByRole("region", { name: "Details for Synthetic North Block" })).toBeTruthy();
  mockTheme = "dark";
  view.rerender(<MemoryRouter><CampusMap /></MemoryRouter>);
  expect(setUrl.mock.calls.some(([url]) => url.includes("dark_all"))).toBe(true);
  act(() => tiles.mock.results[0].value.fire("tileerror"));
  expect(screen.getByRole("alert").textContent).toContain("Some map tiles could not load");
  fireEvent.click(screen.getByRole("button", { name: "Retry map tiles" }));
  expect(redraw).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close building details" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search on map" }), { target: { value: "no-such-place" } });
  expect(screen.getByText("No places matched your search.")).toBeTruthy();
});
test("building details do not invent missing floors or room records", () => {
  render(<BuildingDetail poi={building} pois={[building]} departments={[]} faculty={[]} onClose={jest.fn()} onNavigate={jest.fn()} onToggleFavorite={jest.fn()} />);
  expect(screen.getByText("No floor or room information is recorded.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Ground" })).toBeNull();
});
test("map location errors and fullscreen failures are visible", async () => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (_success, failure) => failure({ code: 1 }) } });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "My location" }));
  expect(screen.getByText(/Location permission was denied/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
  expect(screen.getByText(/Fullscreen is not supported/)).toBeTruthy();
});
