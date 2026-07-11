const pullRequestSignals = [
  { label: "Open PRs", value: 7, detail: "Ready for review or waiting on implementation" },
  { label: "Merged PRs", value: 9, detail: "Merged by autospec after validation" },
  { label: "Pending checks", value: 4, detail: "Required checks still running" },
  { label: "Failed checks", value: 1, detail: "Non-advisory failures requiring investigation" }
];

export default function PullRequestsPage() {
  return (
    <main className="shell section-shell" id="main-content">
      <section className="hero" aria-labelledby="pull-requests-title">
        <p className="eyebrow">read-only autospec telemetry</p>
        <h1 id="pull-requests-title">Pull Requests</h1>
        <p>PR and CI health summaries stay observational only; merge controls belong outside this read-only dashboard.</p>
      </section>

      <section className="detail-grid" aria-label="Pull request health summary">
        {pullRequestSignals.map((signal) => (
          <article className="panel" key={signal.label}>
            <p className="panel-kicker">PR/CI health</p>
            <h2>{signal.label}</h2>
            <p className="metric-value">{signal.value}</p>
            <p>{signal.detail}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
