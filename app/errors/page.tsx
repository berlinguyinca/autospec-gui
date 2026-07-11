const groupedErrors = [
  { message: "Validation timeout while waiting for checks", count: 3, latest: "18m ago" },
  { message: "Telemetry schema missing optional PR health view", count: 1, latest: "42m ago" }
];

export default function ErrorsPage() {
  return (
    <main className="shell section-shell" id="main-content">
      <section className="hero" aria-labelledby="errors-title">
        <p className="eyebrow">read-only autospec telemetry</p>
        <h1 id="errors-title">Errors</h1>
        <p>Grouped error telemetry makes failures visible while keeping recovery and retry actions outside the dashboard.</p>
      </section>

      <section className="panel" aria-labelledby="errors-list-title">
        <p className="panel-kicker">Error summary</p>
        <h2 id="errors-list-title">Grouped failures</h2>
        <ul className="error-list">
          {groupedErrors.map((error) => (
            <li key={error.message}>
              <strong>{error.message}</strong>
              <span>{error.count} occurrences · latest {error.latest}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
