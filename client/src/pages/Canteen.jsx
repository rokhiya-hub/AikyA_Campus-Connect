import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import {
  PageHeader,
  EmptyState,
  SkeletonGrid,
  Chip,
  formatPrice,
} from "../components/ui.jsx";
import {
  ShopSchedule,
  ReportListing,
  stockLabel,
  updatedLabel,
} from "../components/ShopDetails.jsx";

export default function Canteen() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [area, setArea] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({
    data: [],
    loading: true,
    error: "",
    hasMore: false,
  });
  const navigate = useNavigate();
  useEffect(() => {
    const refresh = () => setRetry((v) => v + 1);
    const timer = setInterval(refresh, 60000);
    window.addEventListener("aikya:collections-changed", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("aikya:collections-changed", refresh);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState((old) => ({ ...old, loading: true, error: "" }));
    const timer = setTimeout(() => {
      const params = {
        page,
        limit: 24,
        ...(q.trim() ? { q: q.trim() } : {}),
        ...(category ? { category } : {}),
        ...(itemCategory ? { itemCategory } : {}),
        ...(area.trim() ? { area: area.trim() } : {}),
      };
      api
        .shopPage(params, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted)
            setState({ ...result, loading: false, error: "" });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({
              data: [],
              loading: false,
              error: error.message,
              hasMore: false,
            });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, category, itemCategory, area, page, retry]);
  const filter = (setter) => (event) => {
    setter(event.target.value);
    setPage(1);
  };
  return (
    <div>
      <PageHeader
        kicker="Campus shops"
        title="Food & Shops"
        sub="Find listed products and services. Stock and prices are reports; confirm with the shop before travelling."
      />
      <div className="shop-filters">
        <label>
          Product or service
          <input
            type="search"
            maxLength={100}
            value={q}
            onChange={filter(setQ)}
            placeholder="Food, notebook, xerox…"
          />
        </label>
        <label>
          Shop category
          <select value={category} onChange={filter(setCategory)}>
            <option value="">All categories</option>
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
        <label>
          Item category
          <select value={itemCategory} onChange={filter(setItemCategory)}>
            <option value="">All items</option>
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
          Area
          <input
            maxLength={100}
            value={area}
            onChange={filter(setArea)}
            placeholder="Exact area name"
          />
        </label>
      </div>
      <div className="chips" aria-label="Shop areas">
        {[
          "",
          "Main Campus",
          "Girls Hostel",
          "Boys Hostel",
          "Faculty Block",
        ].map((value) => (
          <Chip
            key={value}
            active={area === value}
            onClick={() => {
              setArea(value);
              setPage(1);
            }}
          >
            {value || "All areas"}
          </Chip>
        ))}
      </div>
      <button
        className="btn btn-soft"
        onClick={() => {
          setQ("");
          setCategory("");
          setItemCategory("");
          setArea("");
          setPage(1);
        }}
      >
        Clear filters
      </button>
      {state.loading ? (
        <div role="status" aria-label="Loading shops">
          <SkeletonGrid count={4} height={180} />
        </div>
      ) : state.error ? (
        <div role="alert">
          <p>{state.error}</p>
          <button
            className="btn btn-soft"
            onClick={() => setRetry((v) => v + 1)}
          >
            Retry shops
          </button>
        </div>
      ) : !state.data.length ? (
        <EmptyState
          title="No matching shops or items"
          subtitle="Try another product, category or area."
        />
      ) : (
        <div className="grid grid-auto">
          {state.data.map((shop) => (
            <article key={shop._id} className="rich-card">
              <h2>{shop.name}</h2>
              {shop.areaGroup && (
                <span className="badge badge-info">{shop.areaGroup}</span>
              )}
              <p>
                {[shop.area, shop.block, shop.floor && `Floor ${shop.floor}`]
                  .filter(Boolean)
                  .join(" · ") || "Location unconfirmed"}
              </p>
              <p className="muted">
                {shop.category} ·{" "}
                {shop.dataStatus === "verified_listing"
                  ? "Verified listing"
                  : "Demo data / unverified listing"}
              </p>
              <p>
                {shop.contact
                  ? `Contact: ${shop.contact}`
                  : "Contact not listed"}
              </p>
              <ShopSchedule shop={shop} />
              <ul className="menu-list">
                {(shop.items || []).map((item) => (
                  <li key={item._id || item.name} className="shop-item">
                    <div>
                      <strong>{item.name}</strong>
                      <p>{stockLabel(item)}</p>
                      <small>
                        {updatedLabel(item.stock?.lastUpdatedAt, "Stock")}
                      </small>
                    </div>
                    <div>
                      {item.price
                        ? formatPrice(item.price)
                        : "Price not listed"}
                      <p className="muted">
                        {item.pricing?.stale !== false && "Price unconfirmed"}
                      </p>
                      <small>
                        {updatedLabel(item.pricing?.lastUpdatedAt, "Price")}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
              {!shop.items?.length && (
                <p className="muted">No items listed yet.</p>
              )}
              <div className="rc-foot">
                <button
                  className="btn btn-soft"
                  onClick={() =>
                    navigate(`/map?poi=${encodeURIComponent(shop._id)}`)
                  }
                >
                  View on campus map
                </button>
              </div>
              <ReportListing shop={shop} />
            </article>
          ))}
        </div>
      )}
      <nav className="shop-pagination" aria-label="Shop result pages">
        <button
          className="btn btn-soft"
          disabled={page === 1 || state.loading}
          onClick={() => setPage((v) => v - 1)}
        >
          Previous
        </button>
        <span aria-live="polite">Page {page}</span>
        <button
          className="btn btn-soft"
          disabled={!state.hasMore || state.loading}
          onClick={() => setPage((v) => v + 1)}
        >
          Next
        </button>
      </nav>
    </div>
  );
}
