import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LiveBusTracking, {
  visibleBus,
} from "../src/components/LiveBusTracking.jsx";
import DriverTracking from "../src/pages/DriverTracking.jsx";
import Buses from "../src/pages/Buses.jsx";
import BusTrackingAdmin from "../src/components/BusTrackingAdmin.jsx";
import { api } from "../src/api/client.js";
let mockSimulationAllowed = false,
  callbacks;
jest.mock("../src/lib/trackingConfig.js", () => ({
  get simulationAllowed() {
    return mockSimulationAllowed;
  },
}));
jest.mock("../src/components/BusTrackingMap.jsx", () => ({
  __esModule: true,
  default: ({ buses }) => (
    <div role="region" aria-label="Authorized bus locations map">
      {buses
        .filter((bus) => bus.location)
        .map((bus) => (
          <span key={bus.busId}>{bus.routeNumber} marker</span>
        ))}
    </div>
  ),
}));
jest.mock("../src/lib/useUniverse.js", () => ({
  useUniverse: () => ({
    data: {
      buses: [
        {
          _id: "synthetic-bus",
          routeNumber: "SYN",
          stops: [{ name: "Synthetic stop", time: "Synthetic schedule" }],
        },
      ],
    },
    loading: false,
  }),
}));
jest.mock("../src/api/client.js", () => ({
  api: Object.fromEntries(
    [
      "trackingStatus",
      "liveBuses",
      "driverSession",
      "driverCurrentTrip",
      "startBusTrip",
      "endBusTrip",
      "sendBusLocation",
      "refreshDriverSession",
      "getBuses",
      "trackingDevices",
      "trackingTrips",
      "authorizeBusDevice",
      "revokeBusDevice",
      "update",
      "create",
    ].map((key) => [key, jest.fn()]),
  ),
}));
const mount = (element) =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {element}
    </MemoryRouter>,
  );
const position = (accuracy) => ({
  coords: { latitude: 17, longitude: 82, accuracy },
  timestamp: Date.now(),
});
const trip = () => ({
  _id: "000000000000000000000002",
  busId: "000000000000000000000001",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
});
beforeEach(() => {
  jest.clearAllMocks();
  mockSimulationAllowed = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: jest.fn((success, error) => {
        callbacks = { success, error };
        return 42;
      }),
      clearWatch: jest.fn(),
    },
  });
  api.trackingStatus.mockResolvedValue({ enabled: true });
  api.liveBuses.mockResolvedValue({ data: [], hasMore: false });
  api.driverSession.mockResolvedValue({
    token: "synthetic-session",
    busId: trip().busId,
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  });
  api.driverCurrentTrip.mockResolvedValue({ trip: null });
  api.startBusTrip.mockImplementation(async () => trip());
  api.endBusTrip.mockResolvedValue({});
  api.sendBusLocation.mockImplementation(async () => ({
    receivedAt: new Date().toISOString(),
  }));
  api.getBuses.mockResolvedValue([
    { _id: trip().busId, routeNumber: "SYN", trackingEnabled: true },
  ]);
  api.trackingDevices.mockResolvedValue({ data: [], hasMore: false });
  api.trackingTrips.mockResolvedValue({ data: [], hasMore: false });
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});
async function authorize() {
  mount(<DriverTracking />);
  fireEvent.change(screen.getByLabelText("Device ID"), {
    target: { value: "000000000000000000000003" },
  });
  fireEvent.change(screen.getByLabelText("Device secret"), {
    target: { value: "a".repeat(64) },
  });
  fireEvent.click(screen.getByRole("button", { name: "Authorize device" }));
  await screen.findByRole("heading", { name: "Assigned bus device" });
}
async function start() {
  await authorize();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Start trip and share GPS" }),
  );
  await waitFor(() =>
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1),
  );
}
test("disabled optional tracking preserves existing bus route and stop browsing", async () => {
  api.trackingStatus.mockResolvedValue({ enabled: false });
  mount(<Buses />);
  await screen.findByText(/Live tracking is not enabled/);
  expect(screen.getByText("Synthetic stop")).toBeTruthy();
  expect(screen.getByText("Synthetic schedule")).toBeTruthy();
  expect(api.liveBuses).not.toHaveBeenCalled();
});
test("student polling follows the 12-second interval, manual refresh and route filter", async () => {
  jest.useFakeTimers();
  api.liveBuses.mockResolvedValue({
    data: [
      {
        busId: "bus",
        tripId: "trip",
        routeNumber: "SYN",
        stops: [],
        receivedAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
        trackingStatus: "live",
        location: { latitude: 17, longitude: 82, accuracy: 150 },
      },
    ],
    hasMore: false,
  });
  mount(<LiveBusTracking routes={[{ _id: "bus", routeNumber: "SYN" }]} />);
  await screen.findByText("SYN marker");
  expect(screen.getByText("Estimated arrival: unavailable")).toBeTruthy();
  expect(screen.getByText(/weak GPS accuracy/)).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(12000);
  });
  expect(api.liveBuses).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByLabelText("Track route"), {
    target: { value: "bus" },
  });
  await waitFor(() =>
    expect(api.liveBuses).toHaveBeenLastCalledWith(
      expect.objectContaining({ busId: "bus" }),
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh tracking" }));
  await waitFor(() => expect(api.liveBuses).toHaveBeenCalledTimes(4));
});
test("stale/offline projection removes expired coordinates even without a successful poll", () => {
  const bus = {
    trackingStatus: "live",
    receivedAt: new Date(100000).toISOString(),
    location: { latitude: 17, longitude: 82 },
  };
  expect(visibleBus(bus, 131000).trackingStatus).toBe("stale");
  expect(visibleBus(bus, 190000).location).toBeNull();
  expect(
    visibleBus(
      { ...bus, authorizationExpiresAt: new Date(110000).toISOString() },
      120000,
    ).location,
  ).toBeNull();
});
test("tracking failures clear markers, expose retry and preserve an empty active-trip state", async () => {
  api.liveBuses.mockRejectedValueOnce(new Error("Synthetic network outage"));
  mount(<LiveBusTracking />);
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("region", { name: "Authorized bus locations map" }),
  ).toBeNull();
  api.liveBuses.mockResolvedValueOnce({ data: [], hasMore: false });
  fireEvent.click(screen.getByRole("button", { name: "Refresh tracking" }));
  await screen.findByText("No authorized active bus trips on this page.");
});
test("development simulation is clearly labelled and never uploads or substitutes into real API data", async () => {
  mockSimulationAllowed = true;
  api.trackingStatus.mockResolvedValue({ enabled: false });
  mount(<LiveBusTracking />);
  await screen.findByText(/Live tracking is not enabled/);
  fireEvent.click(
    screen.getByRole("button", { name: "Development simulation" }),
  );
  await screen.findByText(/SIMULATED — development fixture/);
  expect(screen.getByText("SIMULATED marker")).toBeTruthy();
  expect(api.liveBuses).not.toHaveBeenCalled();
  expect(api.sendBusLocation).not.toHaveBeenCalled();
});
test("driver GPS is off before explicit consent and Stops clear the watch and end the trip", async () => {
  await authorize();
  expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Start trip and share GPS" }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Start trip and share GPS" }),
  );
  await waitFor(() =>
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1),
  );
  await act(async () => {
    callbacks.success(position(15));
  });
  expect(api.sendBusLocation).toHaveBeenCalledTimes(1);
  expect(api.sendBusLocation).toHaveBeenCalledWith(
    trip()._id,
    expect.objectContaining({ latitude: 17, longitude: 82, accuracy: 15 }),
    "synthetic-session",
    expect.anything(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Stop sharing and end trip" }),
  );
  await waitFor(() => expect(api.endBusTrip).toHaveBeenCalled());
  expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(42);
  expect(screen.getByRole("checkbox").checked).toBe(false);
});
test("permission denial stops sharing and weak accuracy is never uploaded", async () => {
  await start();
  await act(async () => {
    callbacks.success(position(500));
  });
  expect(api.sendBusLocation).not.toHaveBeenCalled();
  expect(screen.getByText(/GPS accuracy is too weak/)).toBeTruthy();
  await act(async () => {
    callbacks.error({ code: 1 });
  });
  expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(42);
  expect(api.endBusTrip).toHaveBeenCalled();
  expect(screen.getByText(/GPS permission denied/)).toBeTruthy();
});
test("backgrounding stops local GPS; stop-request failures retain a retry without automatically resuming", async () => {
  await start();
  api.endBusTrip.mockRejectedValueOnce(new Error("Synthetic offline"));
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(42);
  expect(screen.getByText(/Server trip end is unconfirmed/)).toBeTruthy();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  fireEvent(document, new Event("visibilitychange"));
  expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Stop sharing and end trip" }),
  );
  await waitFor(() => expect(api.endBusTrip).toHaveBeenCalledTimes(2));
});
test("a trip start response after backgrounding never starts GPS, even if the page is visible again", async () => {
  let complete;
  api.startBusTrip.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await authorize();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Start trip and share GPS" }),
  );
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
  fireEvent(document, new Event("visibilitychange"));
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  await act(async () => {
    complete(trip());
  });
  expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  expect(api.endBusTrip).toHaveBeenCalled();
});
test("the browser clears GPS locally when its authorized fix lease expires", async () => {
  jest.useFakeTimers();
  await start();
  await act(async () => {
    jest.advanceTimersByTime(91000);
  });
  expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(42);
  expect(api.endBusTrip).toHaveBeenCalled();
  expect(screen.getByText(/GPS authorization expired/)).toBeTruthy();
});
test("upload connection failures stop local sharing instead of retaining an offline GPS queue", async () => {
  await start();
  api.sendBusLocation.mockRejectedValueOnce(
    new Error("Synthetic connection loss"),
  );
  await act(async () => {
    callbacks.success(position(15));
  });
  expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(42);
  expect(api.endBusTrip).toHaveBeenCalled();
  expect(screen.getByText(/no fixes are queued/)).toBeTruthy();
});
test("queued GPS callbacks after Stop cannot upload while the server end request is pending", async () => {
  await start();
  let finish;
  api.endBusTrip.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Stop sharing and end trip" }),
  );
  await act(async () => {
    callbacks.success(position(15));
  });
  expect(api.sendBusLocation).not.toHaveBeenCalled();
  await act(async () => {
    finish({});
  });
});
test("driver unmount clears the watch and best-effort ends the authorized trip", async () => {
  await start();
  cleanup();
  expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(42);
  expect(api.endBusTrip).toHaveBeenCalledWith(
    trip()._id,
    "synthetic-session",
    true,
  );
});
test("admin can provision and revoke a bus device and inspect abandoned trip metadata", async () => {
  const device = {
    _id: "000000000000000000000003",
    busId: trip().busId,
    label: "Synthetic unit",
    enabled: true,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  api.trackingDevices.mockResolvedValue({ data: [device], hasMore: false });
  api.trackingTrips.mockResolvedValue({
    data: [{ ...trip(), leaseExpiresAt: new Date().toISOString() }],
    hasMore: false,
  });
  api.authorizeBusDevice.mockResolvedValue({
    ...device,
    secret: "a".repeat(64),
  });
  api.revokeBusDevice.mockResolvedValue({});
  mount(<BusTrackingAdmin />);
  await screen.findByText("Synthetic unit");
  fireEvent.change(screen.getByLabelText("Assigned bus"), {
    target: { value: trip().busId },
  });
  fireEvent.change(screen.getByLabelText(/Device label/), {
    target: { value: "Synthetic new unit" },
  });
  fireEvent.change(screen.getByLabelText(/Authorization expires/), {
    target: { value: "2026-10-30T12:00" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Create one-time device credential" }),
  );
  await screen.findByLabelText("One-time device secret");
  expect(api.authorizeBusDevice).toHaveBeenCalledWith(
    expect.objectContaining({
      busId: trip().busId,
      label: "Synthetic new unit",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Revoke Synthetic unit" }),
  );
  await waitFor(() =>
    expect(api.revokeBusDevice).toHaveBeenCalledWith(device._id),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: `End trip ${trip()._id}` }),
  );
  await waitFor(() =>
    expect(api.create).toHaveBeenCalledWith(
      `bus-tracking/trips/${trip()._id}/end`,
      {},
    ),
  );
});
