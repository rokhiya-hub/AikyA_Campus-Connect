import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Canteen from "../src/pages/Canteen.jsx";
import {
  ShopSchedule,
  stockLabel,
  ReportListing,
} from "../src/components/ShopDetails.jsx";
import {
  ShopCatalogEditor,
  ShopAdmin,
  ShopOwnerRegistration,
} from "../src/components/ShopManagement.jsx";
import { api } from "../src/api/client.js";
jest.mock("../src/api/client.js", () => ({
  api: {
    shopPage: jest.fn(),
    shopOwners: jest.fn(),
    shopReports: jest.fn(),
    shopOwnerAssignment: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    registerShopOwner: jest.fn(),
  },
}));
const shop = {
  _id: "000000000000000000000001",
  name: "Synthetic shop",
  area: "Synthetic area",
  block: "Synthetic block",
  floor: "1",
  category: "printing",
  contact: "Synthetic contact",
  items: [
    {
      _id: "000000000000000000000002",
      name: "Synthetic Xerox",
      price: "Synthetic display price",
      available: true,
      stock: { confirmation: "unconfirmed", lastUpdatedAt: null },
    },
  ],
};
beforeEach(() => {
  jest.clearAllMocks();
  api.shopPage.mockResolvedValue({ data: [shop], hasMore: false });
  api.shopOwners.mockResolvedValue({ data: [], hasMore: false });
  api.shopReports.mockResolvedValue({ data: [], hasMore: false });
  api.shopOwnerAssignment.mockResolvedValue({ shopOwnerId: null });
  api.update.mockResolvedValue({});
});
afterEach(cleanup);
const mount = (element) =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {element}
    </MemoryRouter>,
  );
test("Canteen searches products with category filters and shows honest legacy stock, price and location", async () => {
  mount(<Canteen />);
  expect(await screen.findByText("Synthetic shop")).toBeTruthy();
  expect(screen.getByText("Availability unconfirmed")).toBeTruthy();
  expect(screen.getByText(/Demo data/)).toBeTruthy();
  expect(screen.getByText("Stock last updated: unknown")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Product or service"), {
    target: { value: "xerox" },
  });
  fireEvent.change(screen.getByLabelText("Item category"), {
    target: { value: "printing" },
  });
  await waitFor(() =>
    expect(api.shopPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: "xerox",
        itemCategory: "printing",
        page: 1,
      }),
      expect.anything(),
    ),
  );
  expect(
    screen.getByRole("button", { name: "View on campus map" }),
  ).toBeTruthy();
});
test("Canteen retries failures, handles empty results and follows bounded pages", async () => {
  api.shopPage.mockRejectedValueOnce(new Error("Synthetic unavailable"));
  mount(<Canteen />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  api.shopPage.mockResolvedValueOnce({ data: [], hasMore: false });
  fireEvent.click(screen.getByRole("button", { name: "Retry shops" }));
  expect(await screen.findByText("No matching shops or items")).toBeTruthy();
  api.shopPage.mockResolvedValue({ data: [shop], hasMore: true });
  fireEvent.change(screen.getByLabelText("Product or service"), {
    target: { value: "notebook" },
  });
  await screen.findByText("Synthetic shop");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(api.shopPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
      expect.anything(),
    ),
  );
});
test("freshness expires even when cached confirmation was recent; schedules distinguish unknown and explicit weekend closure", () => {
  expect(stockLabel({ available: true })).toBe("Availability unconfirmed");
  expect(
    stockLabel({
      stock: {
        confirmation: "recent_report",
        reportedStatus: "in_stock",
        expiresAt: new Date(Date.now() - 1).toISOString(),
      },
    }),
  ).toBe("Availability unconfirmed");
  expect(
    stockLabel({
      stock: {
        confirmation: "recent_report",
        reportedStatus: "in_stock",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    }),
  ).toMatch(/Reported in stock/);
  render(
    <ShopSchedule
      shop={{
        openingSchedule: {
          weekly: { Sunday: [] },
          holidays: [],
          exceptions: [],
        },
      }}
    />,
  );
  expect(screen.getByText("Sunday: Closed")).toBeTruthy();
  expect(screen.getByText("Saturday: Unconfirmed")).toBeTruthy();
  expect(screen.getByText(/Asia\/Kolkata/)).toBeTruthy();
});
test("student feedback submits a scoped item report with moderation wording and shows failures", async () => {
  api.create.mockRejectedValueOnce(new Error("Synthetic report unavailable"));
  render(<ReportListing shop={shop} />);
  fireEvent.change(screen.getByLabelText("What is inaccurate?"), {
    target: { value: "Synthetic wrong stock" },
  });
  fireEvent.change(screen.getByLabelText("Item"), {
    target: { value: shop.items[0]._id },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
  await screen.findByText("Synthetic report unavailable");
  api.create.mockResolvedValueOnce({
    message: "Report queued for admin review",
  });
  fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
  await screen.findByText("Report queued for admin review");
  expect(api.create).toHaveBeenLastCalledWith(`shops/${shop._id}/feedback`, {
    reason: "stock",
    itemId: shop.items[0]._id,
    message: "Synthetic wrong stock",
  });
});
test("owner editor requests assigned shops and edits stock without reconfirming unchanged prices", async () => {
  render(<ShopCatalogEditor owner />);
  await screen.findByText("Edit Synthetic Xerox");
  expect(api.shopPage).toHaveBeenCalledWith(
    expect.objectContaining({ mine: "true" }),
  );
  const form = screen.getByText("Edit Synthetic Xerox").closest("form");
  fireEvent.change(within(form).getByLabelText("Stock report"), {
    target: { value: "out_of_stock" },
  });
  fireEvent.click(within(form).getByRole("button", { name: "Save item" }));
  await waitFor(() =>
    expect(api.update).toHaveBeenCalledWith(
      `shops/${shop._id}/items`,
      shop.items[0]._id,
      expect.objectContaining({ stockStatus: "out_of_stock" }),
    ),
  );
  expect(api.update.mock.calls[0][2].price).toBeUndefined();
  expect(screen.queryByText("Assign or reassign ownership")).toBeNull();
});
test("owner can add menu entries and archive without deleting a listing", async () => {
  render(<ShopCatalogEditor owner />);
  await screen.findByText("Add product or service");
  const form = screen.getByText("Add product or service").closest("form");
  fireEvent.change(within(form).getByLabelText("Item name"), {
    target: { value: "Synthetic new service" },
  });
  api.create.mockResolvedValueOnce({});
  fireEvent.click(within(form).getByRole("button", { name: "Save item" }));
  await waitFor(() =>
    expect(api.create).toHaveBeenCalledWith(
      `shops/${shop._id}/items`,
      expect.objectContaining({ name: "Synthetic new service", price: "" }),
    ),
  );
  await waitFor(() => expect(api.shopPage).toHaveBeenCalledTimes(2));
  fireEvent.click(await screen.findByText("Synthetic Xerox", { exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Archive item" }));
  await waitFor(() =>
    expect(api.update).toHaveBeenCalledWith(
      `shops/${shop._id}/items`,
      shop.items[0]._id,
      { active: false },
    ),
  );
});
test("owner schedule editor preserves unknown days and sends an explicit weekend closure", async () => {
  render(<ShopCatalogEditor owner />);
  await screen.findByText("Contact and opening schedule");
  fireEvent.change(screen.getByLabelText("Sunday"), {
    target: { value: "closed" },
  });
  fireEvent.change(screen.getByLabelText("Monday"), {
    target: { value: "hours" },
  });
  fireEvent.change(screen.getByLabelText("Monday periods"), {
    target: { value: "09:00-12:00, 13:00-18:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  await waitFor(() =>
    expect(api.update).toHaveBeenCalledWith(
      "shops",
      shop._id,
      expect.objectContaining({
        openingSchedule: {
          timeZone: "Asia/Kolkata",
          weekly: {
            Sunday: [],
            Monday: [
              { start: "09:00", end: "12:00" },
              { start: "13:00", end: "18:00" },
            ],
          },
          holidays: [],
          exceptions: [],
        },
      }),
    ),
  );
});
test("admin approves owners, reassigns shops and moderates reports", async () => {
  const owner = {
    _id: "000000000000000000000003",
    name: "Synthetic owner",
    email: "owner@example.test",
    status: "pending",
  };
  api.shopOwners.mockResolvedValue({ data: [owner], hasMore: false });
  api.shopReports.mockResolvedValue({
    data: [
      {
        _id: "000000000000000000000004",
        shopId: shop._id,
        reason: "stock",
        message: "Synthetic listing report",
      },
    ],
    hasMore: false,
  });
  render(<ShopAdmin />);
  await screen.findByText("Synthetic owner");
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() =>
    expect(api.update).toHaveBeenCalledWith("shop-owners", owner._id, {
      status: "approved",
    }),
  );
  fireEvent.change(await screen.findByLabelText("Approved owner account ID"), {
    target: { value: owner._id },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save ownership" }));
  await waitFor(() =>
    expect(api.update).toHaveBeenCalledWith(`shops/${shop._id}`, "owner", {
      ownerId: owner._id,
    }),
  );
  fireEvent.change(screen.getByLabelText("Moderation note"), {
    target: { value: "Synthetic reviewed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
  await waitFor(() =>
    expect(api.update).toHaveBeenCalledWith(
      "shop-feedback",
      "000000000000000000000004",
      { status: "resolved", moderationNote: "Synthetic reviewed" },
    ),
  );
});
test("owner requests never send privileged fields or assigned shops", async () => {
  api.registerShopOwner.mockResolvedValue({
    message: "Request received for approval",
  });
  render(<ShopOwnerRegistration />);
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Synthetic owner" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.change(screen.getByLabelText(/New password/), {
    target: { value: "synthetic-test-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
  await screen.findByText("Request received for approval");
  expect(api.registerShopOwner).toHaveBeenCalledWith({
    name: "Synthetic owner",
    email: "owner@example.test",
    password: "synthetic-test-password",
  });
});
