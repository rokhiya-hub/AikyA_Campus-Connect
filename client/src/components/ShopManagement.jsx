import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { stockLabel } from "./ShopDetails.jsx";
const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const periodsText = (values) =>
  (values || []).map((v) => `${v.start}-${v.end}`).join(", ");
function periods(value) {
  if (!value.trim()) return [];
  return value.split(",").map((part) => {
    const match = /^\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*$/.exec(part);
    if (!match) throw new Error("Use HH:MM-HH:MM, separated by commas.");
    return { start: match[1], end: match[2] };
  });
}
function ScheduleEditor({ shop, onSaved }) {
  const source = shop.openingSchedule;
  const [weekly, setWeekly] = useState(() =>
    Object.fromEntries(
      DAYS.map((day) => [
        day,
        {
          mode: source?.weekly?.[day]
            ? source.weekly[day].length
              ? "hours"
              : "closed"
            : "unknown",
          hours: periodsText(source?.weekly?.[day]),
        },
      ]),
    ),
  );
  const [dated, setDated] = useState(() =>
    ["holidays", "exceptions"].flatMap((kind) =>
      (source?.[kind] || []).map((entry) => ({
        ...entry,
        kind,
        hours: periodsText(entry.periods),
      })),
    ),
  );
  const [contact, setContact] = useState(shop.contact || ""),
    [openHours, setHours] = useState(shop.openHours || ""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(event) {
    event.preventDefault();
    setStatus("");
    setBusy(true);
    try {
      const openingSchedule = {
        timeZone: "Asia/Kolkata",
        weekly: Object.fromEntries(
          DAYS.filter((day) => weekly[day].mode !== "unknown").map((day) => {
            if (weekly[day].mode === "hours" && !weekly[day].hours.trim())
              throw new Error(`Enter opening periods for ${day}.`);
            return [
              day,
              weekly[day].mode === "closed" ? [] : periods(weekly[day].hours),
            ];
          }),
        ),
        holidays: [],
        exceptions: [],
      };
      dated.forEach((entry) =>
        openingSchedule[entry.kind].push({
          date: entry.date,
          label: entry.label || "",
          periods: periods(entry.hours),
        }),
      );
      await api.update("shops", shop._id, {
        contact,
        openHours,
        openingSchedule,
      });
      setStatus("Contact and opening schedule saved.");
      onSaved();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="shop-form" onSubmit={save}>
      <h3>Contact and opening schedule</h3>
      <label>
        Contact
        <input
          maxLength={300}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
      </label>
      <label>
        Display timings
        <input
          maxLength={300}
          value={openHours}
          onChange={(e) => setHours(e.target.value)}
        />
      </label>
      <p>
        Asia/Kolkata. Enter 24-hour periods such as 09:00-12:00, 13:00-18:00.
        Split overnight hours across days. Unknown days remain unconfirmed.
      </p>
      {DAYS.map((day) => (
        <div className="shop-day" key={day}>
          <label>
            {day}
            <select
              value={weekly[day].mode}
              onChange={(e) =>
                setWeekly((old) => ({
                  ...old,
                  [day]: { ...old[day], mode: e.target.value },
                }))
              }
            >
              <option value="unknown">Unknown</option>
              <option value="closed">Closed</option>
              <option value="hours">Opening periods</option>
            </select>
          </label>
          {weekly[day].mode === "hours" && (
            <label>
              {day} periods
              <input
                value={weekly[day].hours}
                onChange={(e) =>
                  setWeekly((old) => ({
                    ...old,
                    [day]: { ...old[day], hours: e.target.value },
                  }))
                }
              />
            </label>
          )}
        </div>
      ))}
      <h4>Holidays and date exceptions</h4>
      <p>
        Exceptions override holidays; holidays override weekly hours. Empty
        periods mean closed.
      </p>
      {dated.map((entry, index) => {
        const change = (key, value) =>
          setDated((old) =>
            old.map((v, i) => (i === index ? { ...v, [key]: value } : v)),
          );
        return (
          <fieldset className="shop-form" key={index}>
            <legend>Date entry {index + 1}</legend>
            <label>
              Type
              <select
                value={entry.kind}
                onChange={(e) => change("kind", e.target.value)}
              >
                <option value="holidays">Holiday</option>
                <option value="exceptions">Exception</option>
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                required
                value={entry.date}
                onChange={(e) => change("date", e.target.value)}
              />
            </label>
            <label>
              Label
              <input
                maxLength={300}
                value={entry.label}
                onChange={(e) => change("label", e.target.value)}
              />
            </label>
            <label>
              Opening periods (empty means closed)
              <input
                value={entry.hours}
                onChange={(e) => change("hours", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-soft"
              onClick={() =>
                setDated((old) => old.filter((v, i) => i !== index))
              }
            >
              Remove date {index + 1}
            </button>
          </fieldset>
        );
      })}
      <button
        type="button"
        className="btn btn-soft"
        disabled={dated.length >= 100}
        onClick={() =>
          setDated((old) => [
            ...old,
            { kind: "exceptions", date: "", label: "", hours: "" },
          ])
        }
      >
        Add date
      </button>
      <button className="btn btn-primary" disabled={busy}>
        Save schedule
      </button>
      <p role="status">{status}</p>
    </form>
  );
}
function ItemEditor({ shop, item, onSaved }) {
  const [name, setName] = useState(item?.name || ""),
    [price, setPrice] = useState(item?.price || ""),
    [category, setCategory] = useState(item?.category || "unclassified"),
    [keywords, setKeywords] = useState((item?.keywords || []).join(", ")),
    [stock, setStock] = useState(""),
    [reportPrice, setReportPrice] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const changes = {
        name,
        category,
        active: true,
        keywords: keywords
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        ...(!item || price !== (item.price || "") || reportPrice
          ? { price }
          : {}),
        ...(stock ? { stockStatus: stock } : {}),
      };
      if (item) await api.update(`shops/${shop._id}/items`, item._id, changes);
      else await api.create(`shops/${shop._id}/items`, changes);
      setStatus(
        "Item saved. Only explicitly reported price or stock gets a new timestamp.",
      );
      onSaved();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    setBusy(true);
    try {
      await api.update(`shops/${shop._id}/items`, item._id, { active: false });
      onSaved();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="shop-form" onSubmit={save}>
      <h4>{item ? `Edit ${item.name}` : "Add product or service"}</h4>
      <label>
        Item name
        <input
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Price as reported (leave blank if unknown)
        <input
          maxLength={100}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>
      {item && (
        <label className="shop-check">
          <input
            type="checkbox"
            checked={reportPrice}
            onChange={(e) => setReportPrice(e.target.checked)}
          />
          Reconfirm this price now
        </label>
      )}
      <label>
        Item category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {[
            "food",
            "beverage",
            "stationery",
            "printing",
            "service",
            "other",
            "unclassified",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Search keywords (comma separated)
        <input
          maxLength={1000}
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
      </label>
      <label>
        Stock report
        <select value={stock} onChange={(e) => setStock(e.target.value)}>
          <option value="">Do not change stock report</option>
          <option value="in_stock">Reported in stock</option>
          <option value="out_of_stock">Reported out of stock</option>
          <option value="unknown">Unknown / unconfirmed</option>
        </select>
      </label>
      {item && <p>{stockLabel(item)}</p>}
      <button className="btn btn-primary" disabled={busy}>
        Save item
      </button>
      {item && (
        <button
          type="button"
          className="btn btn-soft"
          disabled={busy}
          onClick={archive}
        >
          Archive item
        </button>
      )}
      <p role="status">{status}</p>
    </form>
  );
}
export function ShopCatalogEditor({ owner = false }) {
  const [page, setPage] = useState(1),
    [shops, setShops] = useState([]),
    [more, setMore] = useState(false),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api
      .shopPage({
        page,
        limit: 20,
        ...(owner ? { mine: "true" } : { manage: "true" }),
      })
      .then((result) => {
        if (live) {
          setShops(result.data);
          setMore(result.hasMore);
          setSelected((old) =>
            result.data.some((v) => v._id === old)
              ? old
              : result.data[0]?._id || "",
          );
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [page, owner, revision]);
  const shop = shops.find((v) => v._id === selected);
  const refresh = () => setRevision((v) => v + 1);
  return (
    <section>
      <h2>{owner ? "Your assigned shops" : "Shop listings and menus"}</h2>
      {loading ? (
        <p role="status">Loading shops…</p>
      ) : error ? (
        <div role="alert">
          {error}
          <button className="btn btn-soft" onClick={refresh}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <label className="shop-form">
            Choose shop
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {shops.map((v) => (
                <option key={v._id} value={v._id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          {!shops.length && <p>No shops assigned or listed on this page.</p>}
          <div className="shop-pagination">
            <button
              className="btn btn-soft"
              disabled={page === 1}
              onClick={() => setPage((v) => v - 1)}
            >
              Previous shops
            </button>
            <span>Page {page}</span>
            <button
              className="btn btn-soft"
              disabled={!more}
              onClick={() => setPage((v) => v + 1)}
            >
              Next shops
            </button>
          </div>
          {shop && (
            <div key={shop._id}>
              <p>
                Demo / unverified until officially confirmed. Never enter
                guessed prices or stock.
              </p>
              <ScheduleEditor shop={shop} onSaved={refresh} />
              <div className="grid grid-auto">
                {shop.items.map((item) => (
                  <details className="rich-card" key={item._id}>
                    <summary>
                      {item.name}
                      {item.active === false ? " (archived)" : ""}
                    </summary>
                    <ItemEditor shop={shop} item={item} onSaved={refresh} />
                  </details>
                ))}
                <article className="rich-card">
                  <ItemEditor shop={shop} onSaved={refresh} />
                </article>
              </div>
              {!owner && (
                <>
                  <ShopVerification shop={shop} onSaved={refresh} />
                  <Ownership shop={shop} />
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
function ShopVerification({ shop, onSaved }) {
  const [category, setCategory] = useState(shop.category || "unclassified"),
    [verified, setVerified] = useState(
      shop.shopVerification?.status === "verified",
    ),
    [source, setSource] = useState(shop.shopVerification?.source || ""),
    [date, setDate] = useState(
      shop.shopVerification?.verifiedAt?.slice(0, 10) || "",
    ),
    [status, setStatus] = useState("");
  async function save(event) {
    event.preventDefault();
    try {
      await api.update("shops", shop._id, {
        category,
        shopVerification: verified
          ? {
              status: "verified",
              source,
              verifiedAt: new Date(`${date}T00:00:00+05:30`).toISOString(),
            }
          : { status: "unverified" },
      });
      setStatus("Listing classification saved.");
      onSaved();
    } catch (error) {
      setStatus(error.message);
    }
  }
  return (
    <form className="shop-form" onSubmit={save}>
      <h3>Admin listing verification</h3>
      <label>
        Shop category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {[
            "food",
            "stationery",
            "printing",
            "grocery",
            "services",
            "other",
            "unclassified",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label className="shop-check">
        <input
          type="checkbox"
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
        />
        Officially verified listing (does not verify live inventory)
      </label>
      {verified && (
        <>
          <label>
            Official confirmation source
            <input
              required
              maxLength={1000}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <label>
            Date confirmed
            <input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </>
      )}
      <button className="btn btn-soft">Save classification</button>
      <p role="status">{status}</p>
    </form>
  );
}
function Ownership({ shop }) {
  const [ownerId, setOwner] = useState(""),
    [status, setStatus] = useState("");
  useEffect(() => {
    let live = true;
    api
      .shopOwnerAssignment(shop._id)
      .then((result) => {
        if (live) setOwner(result.shopOwnerId || "");
      })
      .catch((error) => {
        if (live) setStatus(error.message);
      });
    return () => {
      live = false;
    };
  }, [shop._id]);
  async function save(event) {
    event.preventDefault();
    try {
      await api.update(`shops/${shop._id}`, "owner", {
        ownerId: ownerId.trim() || null,
      });
      setStatus(
        "Ownership updated. Previous assignments no longer grant access.",
      );
    } catch (error) {
      setStatus(error.message);
    }
  }
  return (
    <form className="shop-form" onSubmit={save}>
      <h3>Assign or reassign ownership</h3>
      <p>
        Copy an approved account ID from the owner list. Leave blank to remove
        assignment.
      </p>
      <label>
        Approved owner account ID
        <input
          value={ownerId}
          onChange={(e) => setOwner(e.target.value)}
          maxLength={24}
          pattern="[a-fA-F0-9]{24}"
        />
      </label>
      <button className="btn btn-soft">Save ownership</button>
      <p role="status">{status}</p>
    </form>
  );
}
export function ShopAdmin() {
  const [owners, setOwners] = useState([]),
    [reports, setReports] = useState([]),
    [page, setPage] = useState(1),
    [reportPage, setReportPage] = useState(1),
    [ownerMore, setOwnerMore] = useState(false),
    [reportMore, setReportMore] = useState(false),
    [status, setStatus] = useState(""),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setStatus("");
    Promise.all([api.shopOwners(page), api.shopReports(reportPage)])
      .then(([a, b]) => {
        if (live) {
          setOwners(a.data);
          setReports(b.data);
          setOwnerMore(a.hasMore);
          setReportMore(b.hasMore);
        }
      })
      .catch((e) => {
        if (live) setStatus(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [page, reportPage, revision]);
  async function changeOwner(id, state) {
    try {
      await api.update("shop-owners", id, { status: state });
      setRevision((v) => v + 1);
    } catch (error) {
      setStatus(error.message);
    }
  }
  return (
    <div>
      <h2>Owners and listing reports</h2>
      <p role="status">{loading ? "Loading moderation queues…" : status}</p>
      <button
        className="btn btn-soft"
        onClick={() => setRevision((v) => v + 1)}
      >
        Refresh queues
      </button>
      <h3>Owner approvals</h3>
      {!owners.length && !loading && <p>No account requests on this page.</p>}
      {owners.map((owner) => (
        <article className="rich-card" key={owner._id}>
          <h4>{owner.name}</h4>
          <p>
            {owner.email} · {owner.status}
          </p>
          <p>
            Account ID: <code>{owner._id}</code>
          </p>
          <div className="shop-pagination">
            {["approved", "suspended", "pending"].map((state) => (
              <button
                className="btn btn-soft"
                key={state}
                disabled={owner.status === state}
                onClick={() => changeOwner(owner._id, state)}
              >
                {state === "approved"
                  ? "Approve"
                  : state === "suspended"
                    ? "Suspend"
                    : "Mark pending"}
              </button>
            ))}
          </div>
        </article>
      ))}
      <div className="shop-pagination">
        <button
          className="btn btn-soft"
          disabled={page === 1}
          onClick={() => setPage((v) => v - 1)}
        >
          Previous owners
        </button>
        <span>Page {page}</span>
        <button
          className="btn btn-soft"
          disabled={!ownerMore}
          onClick={() => setPage((v) => v + 1)}
        >
          Next owners
        </button>
      </div>
      <h3>Pending reports</h3>
      {!reports.length && !loading && <p>No pending reports on this page.</p>}
      {reports.map((report) => (
        <Moderation
          key={report._id}
          report={report}
          onSaved={() => setRevision((v) => v + 1)}
        />
      ))}
      <div className="shop-pagination">
        <button
          className="btn btn-soft"
          disabled={reportPage === 1}
          onClick={() => setReportPage((v) => v - 1)}
        >
          Previous reports
        </button>
        <span>Page {reportPage}</span>
        <button
          className="btn btn-soft"
          disabled={!reportMore}
          onClick={() => setReportPage((v) => v + 1)}
        >
          Next reports
        </button>
      </div>
      <ShopCatalogEditor />
    </div>
  );
}
function Moderation({ report, onSaved }) {
  const [note, setNote] = useState(""),
    [state, setState] = useState("resolved"),
    [error, setError] = useState("");
  async function save(event) {
    event.preventDefault();
    try {
      await api.update("shop-feedback", report._id, {
        status: state,
        moderationNote: note,
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <form className="rich-card shop-form" onSubmit={save}>
      <h4>{report.reason} · Unverified student/guest report</h4>
      <p>
        Shop: {report.shopId}
        {report.itemId && ` · Item: ${report.itemId}`}
      </p>
      <p>{report.message}</p>
      <label>
        Decision
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </label>
      <label>
        Moderation note
        <textarea
          required
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <button className="btn btn-soft">Save decision</button>
      <p role="alert">{error}</p>
    </form>
  );
}
export function ShopOwnerRegistration() {
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api.registerShopOwner({ name, email, password });
      setStatus(result.message);
      setPassword("");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="shop-registration">
      <summary>Request a shop-owner account</summary>
      <form className="shop-form" onSubmit={submit}>
        <label>
          Name
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          New password (12 characters minimum)
          <input
            required
            type="password"
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="btn btn-soft" disabled={busy}>
          Request approval
        </button>
        <p role="status">{status}</p>
      </form>
    </details>
  );
}
