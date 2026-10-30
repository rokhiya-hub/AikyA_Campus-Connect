export default function DataStatus({ loading, error, retry, children }) {
  return <>
    {loading && <p role="status" className="muted">Loading campus information…</p>}
    {error && <div role="alert" className="campus-data-error"><p>Some campus information could not be loaded. {error}</p><button className="btn btn-soft" onClick={() => retry()} disabled={loading}>Retry</button></div>}
    {children}
  </>;
}
