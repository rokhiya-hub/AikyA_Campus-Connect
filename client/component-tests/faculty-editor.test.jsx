import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import FacultyPortal from "../src/components/FacultyPortal.jsx";
import AdminCrud from "../src/components/AdminCrud.jsx";
import { api } from "../src/api/client.js";
jest.mock("../src/api/client.js", () => ({ api: { getFacultyProfile: jest.fn(), getFacultyTimetable: jest.fn(), updateFacultyTimetable: jest.fn(), update: jest.fn(), getFaculty: jest.fn(), create: jest.fn() } }));
jest.mock("../src/context/AuthContext.jsx", () => ({ useAuth: () => ({ user: { id: "synthetic-owner", username: "synthetic" } }) }));
jest.mock("../src/context/ToastContext.jsx", () => ({ useToast: () => ({ toast() {} }) }));
const timetable = { name: "Synthetic Lecturer", timetable: { Monday: [{ start: "09:00", end: "10:00", subject: "Synthetic subject" }], Tuesday: [{ start: "10:00", end: "11:00" }] },
  freeTime: { Monday: ["10:00 AM - 5:00 PM"], Tuesday: ["9:00 AM - 10:00 AM", "11:00 AM - 5:00 PM"] }, availableSlots: ["Monday: 10:00 AM - 5:00 PM"], onLeave: false,
  availability: { calculatedAt: "2026-10-29T06:00:00.000Z" } };
beforeEach(() => {
  Object.values(api).forEach((method) => method.mockReset());
  api.getFacultyProfile.mockResolvedValue({ _id: "synthetic-owner", name: "Synthetic Lecturer", departmentName: "Synthetic department", subjects: [] });
  api.getFacultyTimetable.mockResolvedValue(timetable);
  api.getFaculty.mockResolvedValue([]);
});
afterEach(cleanup);
async function editor() {
  render(<FacultyPortal facultyId="synthetic-owner" />);
  await screen.findByRole("button", { name: "Timetable & availability" });
  fireEvent.click(screen.getByRole("button", { name: "Timetable & availability" }));
  await screen.findByLabelText("Monday period 1 start");
}
test("faculty editor retains day-specific responses and reports server timetable validation errors", async () => {
  await editor();
  expect(screen.getByText("Monday: 10:00 AM - 5:00 PM")).toBeTruthy();
  expect(screen.getByText("9:00 AM - 10:00 AM")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Monday period 1 end"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save timetable" }));
  expect(screen.getByText("Complete the start and end times for Monday.")).toBeTruthy();
  expect(api.updateFacultyTimetable).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Monday period 1 end"), { target: { value: "10:00" } });
  api.updateFacultyTimetable.mockRejectedValueOnce(new Error("Invalid timetable: check overlaps and teaching windows"));
  fireEvent.click(screen.getByRole("button", { name: "Save timetable" }));
  await screen.findByText("Invalid timetable: check overlaps and teaching windows");
  expect(screen.getByLabelText("Tuesday period 1 start").value).toBe("10:00");
});
test("faculty editor displays the new calculation timestamp after a successful save", async () => {
  api.updateFacultyTimetable.mockResolvedValue({ ...timetable, availability: { calculatedAt: "2026-10-29T07:00:00.000Z" } });
  await editor();
  fireEvent.click(screen.getByRole("button", { name: "Save timetable" }));
  await screen.findByText("Calculated at 2026-10-29T07:00:00.000Z");
  expect(api.updateFacultyTimetable.mock.calls[0][1].Tuesday[0].start).toBe("10:00");
});
test("admin teaching-window JSON is parsed before submission and invalid JSON preserves the form", async () => {
  const entity = { key: "faculty", label: "Faculty", description: "Synthetic test form", fields: [{ name: "name", label: "Name", type: "text" }, { name: "teachingWindows", label: "Teaching windows", type: "json" }] };
  render(<AdminCrud entity={entity} />);
  await screen.findByText("No records yet. Add the first one above.");
  fireEvent.click(screen.getByRole("button", { name: /Add Facult/ }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Synthetic Lecturer" } });
  fireEvent.change(screen.getByLabelText("Teaching windows"), { target: { value: "{" } });
  fireEvent.click(screen.getByRole("button", { name: "Add record" }));
  await screen.findByText("Teaching windows must be valid JSON");
  expect(api.create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Teaching windows"), { target: { value: '{"Monday":[{"start":"09:00","end":"17:00"}]}' } });
  api.create.mockResolvedValue({ _id: "synthetic" });
  fireEvent.click(screen.getByRole("button", { name: "Add record" }));
  await waitFor(() => expect(api.create).toHaveBeenCalledWith("faculty", { name: "Synthetic Lecturer", teachingWindows: { Monday: [{ start: "09:00", end: "17:00" }] } }));
});
