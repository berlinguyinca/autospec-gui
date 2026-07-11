const runRows = [
  { id: "run-2", repository: "berlinguyinca/autospec-gui", branch: "feat/example", status: "running", window: "last 24 hours" },
  { id: "run-1", repository: "berlinguyinca/autospec-gui", branch: "main", status: "merged", window: "last 24 hours" }
];

export default function RunsPage() {
  return (
    <main className="shell section-shell" id="main-content">
      <section className="hero" aria-labelledby="runs-title">
        <p className="eyebrow">read-only autospec telemetry</p>
        <h1 id="runs-title">Runs</h1>
        <p>Recent run summaries for the last 24 hours. Filters and database-backed rows can land here without adding write controls.</p>
      </section>

      <section className="panel" aria-labelledby="runs-table-title">
        <p className="panel-kicker">Run list</p>
        <h2 id="runs-table-title">Representative recent runs</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Repository</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Window</th>
              </tr>
            </thead>
            <tbody>
              {runRows.map((run) => (
                <tr key={run.id}>
                  <td>{run.id}</td>
                  <td>{run.repository}</td>
                  <td>{run.branch}</td>
                  <td><span className="status-pill">{run.status}</span></td>
                  <td>{run.window}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
