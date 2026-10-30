import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { useUniverse, resetUniverseCache } from "../src/lib/useUniverse.js";
import { api } from "../src/api/client.js";
jest.mock("../src/api/client.js", () => ({ api: { getFaculty: jest.fn(), getDepartments: jest.fn(), getPOIs: jest.fn(), getBuses: jest.fn(), getEvents: jest.fn() } }));
beforeEach(() => { resetUniverseCache(); Object.values(api).forEach((method) => method.mockReset().mockResolvedValue([])); });
afterEach(cleanup);
test("collection failures remain errors and retry recovers without poisoning empty caches", async () => {
  api.getFaculty.mockRejectedValueOnce(new Error("Synthetic outage")).mockResolvedValueOnce([{ _id: "recovered" }]);
  const hook = renderHook(() => useUniverse(["faculty", "events"]));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.error).toContain("Synthetic outage");
  expect(hook.result.current.data.faculty).toBeUndefined();
  expect(hook.result.current.data.events).toEqual([]);
  await act(async () => { await hook.result.current.refresh("faculty"); });
  expect(hook.result.current.error).toBe("");
  expect(hook.result.current.data.faculty).toEqual([{ _id: "recovered" }]);
});
test("a shared backend outage is summarized once while preserving each collection error", async () => {
  for (const method of Object.values(api)) method.mockRejectedValue(new Error("Campus API unavailable"));
  const hook = renderHook(() => useUniverse());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.error.match(/Campus API unavailable/g)).toHaveLength(1);
  expect(Object.keys(hook.result.current.errors)).toHaveLength(5);
  expect(hook.result.current.error).toContain("faculty, departments, pois, buses, events");
  expect(hook.result.current.data).toEqual({});
});
test("refresh updates all mounted consumers and failed refresh preserves last good data", async () => {
  api.getFaculty.mockResolvedValueOnce([{ _id: "old" }]).mockResolvedValueOnce([{ _id: "new" }]).mockRejectedValueOnce(new Error("Refresh outage"));
  const first = renderHook(() => useUniverse(["faculty"]));
  const second = renderHook(() => useUniverse(["faculty"]));
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  expect(api.getFaculty).toHaveBeenCalledTimes(1);
  await act(async () => { await first.result.current.refresh(); });
  expect(second.result.current.data.faculty[0]._id).toBe("new");
  await act(async () => { await second.result.current.refresh(); });
  expect(first.result.current.data.faculty[0]._id).toBe("new");
  expect(first.result.current.error).toContain("Refresh outage");
});
test("successful mutations invalidate public data across mounted consumers", async () => {
  api.getFaculty.mockResolvedValueOnce([{ _id: "old" }]).mockResolvedValueOnce([{ _id: "updated" }]);
  const hook = renderHook(() => useUniverse(["faculty"]));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  act(() => window.dispatchEvent(new CustomEvent("aikya:collections-changed", { detail: "faculty" })));
  await waitFor(() => expect(hook.result.current.data.faculty[0]._id).toBe("updated"));
});
test("a mutation during an in-flight fetch schedules a fresh read rather than retaining stale data", async () => {
  let finish;
  api.getFaculty.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce([{ _id: "after-mutation" }]);
  const hook = renderHook(() => useUniverse(["faculty"]));
  await waitFor(() => expect(api.getFaculty).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new CustomEvent("aikya:collections-changed", { detail: "faculty" })));
  await act(async () => { finish([{ _id: "before-mutation" }]); });
  await waitFor(() => expect(hook.result.current.data.faculty[0]._id).toBe("after-mutation"));
  expect(api.getFaculty).toHaveBeenCalledTimes(2);
});
