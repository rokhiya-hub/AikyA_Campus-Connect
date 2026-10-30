import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AIConsole from "../src/components/AIConsole.jsx";
import ChatEvidence, { evidenceCard } from "../src/components/ChatEvidence.jsx";
import { api } from "../src/api/client.js";
jest.mock("../src/api/client.js", () => ({ api: { sendChatMessage: jest.fn() } }));
jest.mock("../src/context/ToastContext.jsx", () => ({ useToast: () => ({}) }));
jest.mock("../src/components/AIOrb.jsx", () => () => <div />);
jest.mock("framer-motion", () => {
  const React = require("react"), tags = {};
  return { AnimatePresence: ({ children }) => children, motion: new Proxy({}, { get: (_, tag) => tags[tag] ||= React.forwardRef(({ initial, animate, exit, transition, whileHover, whileTap, ...props }, ref) => React.createElement(tag, { ...props, ref })) }) };
});
afterEach(() => { cleanup(); jest.clearAllMocks(); });
const mount = (element = <AIConsole data={{}} />) => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{element}</MemoryRouter>);
const submit = () => {
  fireEvent.change(screen.getByRole("textbox", { name: "Ask AIKYA AI" }), { target: { value: "Find library" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
};
test("loading, local default, unavailable and retry preserve explicit one-question consent", async () => {
  let resolve;
  api.sendChatMessage.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  api.sendChatMessage.mockResolvedValue({ answer: "Recorded library", status: "answered", sources: [] });
  mount();
  fireEvent.click(screen.getByRole("checkbox"));
  submit();
  expect(screen.getByText("Checking records")).toBeTruthy();
  expect(api.sendChatMessage.mock.calls[0][1]).toBe(true);
  expect(screen.getByRole("checkbox").checked).toBe(false);
  resolve({ answer: "No record", status: "unavailable", retryable: true, sources: [] });
  fireEvent.click(await screen.findByRole("button", { name: "Retry question" }));
  await screen.findByText("Recorded library");
  expect(api.sendChatMessage.mock.calls[1][1]).toBe(false);
  expect(api.sendChatMessage.mock.calls[1][2]).toBeInstanceOf(AbortSignal);
});
test("network failures show safe retry text and abort pending requests on unmount", async () => {
  api.sendChatMessage.mockRejectedValueOnce(new Error("private provider payload"));
  const view = mount(); submit();
  await screen.findByText(/campus service is unavailable/);
  expect(screen.queryByText(/private provider payload/)).toBeNull();
  api.sendChatMessage.mockImplementationOnce(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Retry question" }));
  const signal = api.sendChatMessage.mock.calls[1][2];
  view.unmount(); expect(signal.aborted).toBe(true);
});
test("clarification uses source labels, rejects external links and never fabricates a result card", () => {
  const clarify = jest.fn(), source = { id: "one", recordId: "one", type: "BusRoute", label: "Synthetic route", path: "/buses" };
  mount(<ChatEvidence message={{ status: "clarification", sources: [source, { ...source, id: "bad", path: "https://evil.example", label: "Unsafe link" }] }} onClarify={clarify} />);
  fireEvent.click(screen.getByRole("button", { name: "Ask about Synthetic route" }));
  expect(clarify).toHaveBeenCalledWith("Tell me about Synthetic route");
  expect(screen.getByRole("link").getAttribute("href")).toBe("/buses");
  expect(screen.queryByText("Unsafe link")).toBeNull();
  expect(evidenceCard({ status: "clarification", sources: [source] }, { buses: [{ _id: "one" }] })).toBeNull();
  expect(evidenceCard({ status: "answered", sources: [source] }, { buses: [{ _id: "other" }] })).toBeNull();
  expect(evidenceCard({ status: "answered", sources: [source] }, { buses: [{ _id: "one" }] }).item._id).toBe("one");
});
