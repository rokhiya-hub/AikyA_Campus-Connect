import React from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import DirectionsPanel from "../src/components/DirectionsPanel.jsx";
jest.mock("../src/api/client.js", () => ({ api: {} }));
let callbacks;
beforeEach(() => { Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: jest.fn((success, failure) => { callbacks = { success, failure }; }) } }); });
afterEach(cleanup);
const target = { name: "Synthetic destination", latitude: 17.1, longitude: 82.1, floor: "4th Floor", coordinateVerification: { status: "unverified" } };
test("directions identify estimates, unknown accessibility and missing official coordinates", () => {
  render(<DirectionsPanel target={target} onClose={jest.fn()} />);
  expect(screen.getByText(/Destination coordinates unverified/)).toBeTruthy();
  expect(screen.getByText(/not a route to follow/)).toBeTruthy();
  expect(screen.queryByText("Exit through the Main Gate (ADB Road)")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Accessibility information" }));
  expect(screen.getByText(/No verified ramp, lift/)).toBeTruthy();
  const link = screen.getByRole("link", { name: "Open directions in Maps" });
  expect(link.href).toContain("destination=17.1,82.1");
  expect(link.href).not.toContain("origin=");
});
test.each([1, 2, 3])("location permission/unavailable/timeout error %s is visible and retryable", (code) => {
  render(<DirectionsPanel target={target} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
  act(() => callbacks.failure({ code }));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Use my location" }).disabled).toBe(false);
});
test("GPS accuracy is exposed and no room-level accuracy is claimed", () => {
  const onLocate = jest.fn();
  render(<DirectionsPanel target={target} onLocate={onLocate} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
  act(() => callbacks.success({ coords: { latitude: 17, longitude: 82, accuracy: 150 }, timestamp: Date.now() }));
  expect(screen.getByRole("status").textContent).toContain("±150 m");
  expect(screen.getByRole("status").textContent).toContain("Low precision");
  expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ accuracy: 150 }));
  expect(screen.getByRole("link").href).toContain("origin=17,82");
});
test("invalid coordinates cannot produce external routes", () => {
  render(<DirectionsPanel target={{ name: "Unlocated place", latitude: 100, longitude: NaN }} onClose={jest.fn()} />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText(/Valid destination coordinates are not available/)).toBeTruthy();
});
test("a synchronous browser location failure does not leave the control stuck", () => {
  navigator.geolocation.getCurrentPosition.mockImplementation(() => { throw new Error("Synthetic browser policy failure"); });
  render(<DirectionsPanel target={target} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
  expect(screen.getByRole("alert").textContent).toContain("Could not obtain a valid location");
  expect(screen.getByRole("button", { name: "Use my location" }).disabled).toBe(false);
});
