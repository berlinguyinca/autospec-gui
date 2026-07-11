const issueSignals = [
  { label: "Created", value: 18 },
  { label: "Classified", value: 15 },
  { label: "Implemented", value: 11 },
  { label: "Merged", value: 9 },
  { label: "Failed", value: 2 }
];

export default function IssuesPage() {
  return (
    <main className="shell section-shell" id="main-content">
      <section className="hero" aria-labelledby="issues-title">
        <p className="eyebrow">read-only autospec telemetry</p>
        <h1 id="issues-title">Issues</h1>
        <p>Issue throughput sections summarize autospec discovery and implementation flow without exposing mutation actions.</p>
      </section>

      <section className="summary-grid section-grid" aria-label="Issue throughput summary">
        {issueSignals.map((signal) => (
          <article className="panel" key={signal.label}>
            <p className="panel-kicker">Issue throughput</p>
            <h2>{signal.label}</h2>
            <p className="metric-value">{signal.value}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
