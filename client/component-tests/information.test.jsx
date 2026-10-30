import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Faculty from "../src/pages/Faculty.jsx";
import Departments from "../src/pages/Departments.jsx";
import Dashboard from "../src/pages/Dashboard.jsx";
import { campusDate, findBuilding, matchesFaculty, mapLink } from "../src/lib/campusInfo.js";
let mockState;
jest.mock("../src/lib/useUniverse.js", () => ({ useUniverse: () => mockState }));
jest.mock("../src/lib/useFavorites.js", () => ({ useFavorites: () => ({ favorites: [], recents: [] }) }));
jest.mock("../src/components/CampusMap.jsx", () => ({ __esModule: true, default: () => <div>Map preview</div> }));
jest.mock("../src/components/AIConsole.jsx", () => ({ __esModule: true, default: () => <div>Campus assistant</div> }));
jest.mock("framer-motion", () => {
  const React = require("react"), tags = {};
  return { motion: new Proxy({}, { get: (_, tag) => tags[tag] ||= React.forwardRef(({ initial, animate, exit, transition, whileInView, viewport, ...props }, ref) => React.createElement(tag, { ...props, ref })) }),
    useInView: () => true, animate: (_from, to, options) => { options.onUpdate(to); return { stop() {} }; } };
});
beforeEach(() => { mockState = { data: {}, loading: false, error: "", errors: {}, statuses: {}, refresh: jest.fn() }; });
afterEach(cleanup);
const mount = (element) => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{element}</MemoryRouter>);
test("faculty search spans name, department, cabin and block with day-specific gaps", () => {
  mockState.data.faculty = [{ _id: "one", name: "Synthetic Ada", departmentName: "Computing", cabin: "R201", block: "North Block", onLeave: false,
    availability: { currentStatus: "teaching", calculatedAt: new Date().toISOString(), byDay: { Monday: { status: "scheduled", freePeriods: [{ start: "10:00", end: "11:00" }], freeTime: ["10:00 AM - 11:00 AM"] }, Tuesday: { status: "scheduled", freePeriods: [], freeTime: [] } } } }];
  mount(<Faculty />);
  const search = screen.getByRole("textbox", { name: "Search faculty" });
  for (const query of ["Ada", "Computing", "R201", "North Block"]) {
    fireEvent.change(search, { target: { value: query } });
    expect(screen.getByText("Synthetic Ada")).toBeTruthy();
  }
  fireEvent.change(screen.getByLabelText("Availability weekday"), { target: { value: "Monday" } });
  fireEvent.click(screen.getByRole("button", { name: "Timetable gaps" }));
  expect(screen.getByText(/Monday: 10:00 AM/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Availability weekday"), { target: { value: "Tuesday" } });
  expect(screen.getByText("No faculty matched")).toBeTruthy();
  expect(screen.queryByText("Available")).toBeNull();
});
test("stable building IDs take precedence and ambiguous labels never link by prefix", () => {
  const buildings = [{ _id: "a", type: "block", name: "North Block" }, { _id: "b", type: "block", name: "North Block Annex" }];
  expect(findBuilding({ buildingId: "b", block: "North Block" }, buildings)._id).toBe("b");
  expect(findBuilding({ block: "North" }, buildings)).toBeNull();
  expect(findBuilding({ block: "North Block" }, [...buildings, { _id: "c", type: "block", name: "North Block" }])).toBeNull();
  expect(mapLink({ buildingId: "b" }, buildings)).toBe("/map?poi=b");
  expect(matchesFaculty({ name: "Ada", departmentName: "Computing", block: "North Block" }, "Ada North")).toBe(true);
});
test("departments distinguish errors from empty data and show unverified assignments", () => {
  mockState.error = "departments: unavailable";
  const view = mount(<Departments />);
  expect(screen.getByRole("alert").textContent).toContain("unavailable");
  expect(screen.queryByText("No departments yet")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(mockState.refresh).toHaveBeenCalled();
  mockState.error = "";
  mockState.data.departments = [{ _id: "dept", name: "Synthetic department", code: "SYN", block: "North Block", floor: "4th Floor", labs: ["Recorded lab"] }];
  view.rerender(<MemoryRouter><Departments /></MemoryRouter>);
  expect(screen.getByText("Building allocation unverified")).toBeTruthy();
  expect(screen.getByText("Recorded lab")).toBeTruthy();
});
test("dashboard has loading, genuine empty, partial error and retry states", () => {
  mockState.loading = true;
  mockState.statuses = { faculty: "loading", buses: "loading", pois: "loading", events: "loading" };
  const view = mount(<Dashboard />);
  expect(screen.getByRole("status").textContent).toContain("Loading");
  expect(screen.queryByText("No campus information yet")).toBeNull();
  mockState.loading = false;
  mockState.error = "faculty: unavailable";
  mockState.errors.faculty = "unavailable";
  view.rerender(<MemoryRouter><Dashboard /></MemoryRouter>);
  expect(screen.getByRole("alert").textContent).toContain("faculty");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(mockState.refresh).toHaveBeenCalled();
  mockState.error = ""; mockState.errors = {}; mockState.data = { events: [], faculty: [], pois: [], buses: [], departments: [] };
  view.rerender(<MemoryRouter><Dashboard /></MemoryRouter>);
  expect(screen.getByText("No campus information yet")).toBeTruthy();
});
test("dashboard uses campus dates, excludes past events and never counts leave flags as presence", () => {
  expect(campusDate(new Date("2026-10-28T20:00:00Z"))).toBe("2026-10-29");
  mockState.data = { faculty: [{ _id: "unknown", onLeave: false }], pois: [], buses: [], events: [{ _id: "past", date: "2000-01-01", title: "Past synthetic event" }, { _id: "demo", date: "2099-01-01", title: "Unverified future event" }, { _id: "future", date: "2099-01-01", startsAt: "2099-01-01T06:00:00Z", title: "Future synthetic event", verification: { status: "verified", source: "Synthetic test circular", verifiedAt: "2020-01-01T00:00:00Z" } }] };
  mount(<Dashboard />);
  expect(screen.queryByText("Past synthetic event")).toBeNull();
  expect(screen.queryByText("Unverified future event")).toBeNull();
  expect(screen.getAllByText("Future synthetic event").length).toBeGreaterThan(0);
  expect(screen.getByText("Physical presence is not tracked")).toBeTruthy();
  expect(screen.queryByText("On campus now")).toBeNull();
});
