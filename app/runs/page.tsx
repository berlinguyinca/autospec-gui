import { AutospecConfigError } from "../../src/server/config";
import { getTelemetryOverview, type RecentRun, type TelemetryOverview } from "../../src/server/telemetry";

export const dynamic = "force-dynamic";

type RunsPageState =
  | { kind: "ready"; overview: TelemetryOverview }
  | { kind: "config-missing"; message: string };

export default async function RunsPage() {
  const state = await getRunsPageState();

  return (
    <main className="shell section-shell" id="main-content">
      <section className="hero" aria-labelledby="runs-title">
        <p className="eyebrow">read-only autospec telemetry</p>
        <h1 id="runs-title">Runs</h1>
        <p>Recent run summaries for the last 24 hours, rendered on the server from the configured telemetry read model.</p>
      </section>

      {state.kind === "config-missing" ? <MissingConfigState message={state.message} /> : <RunsPanel overview={state.overview} />}
    </main>
  );
}

async function getRunsPageState(): Promise<RunsPageState> {
  try {
    return { kind: "ready", overview: await getTelemetryOverview(24) };
  } catch (error) {
    if (error instanceof AutospecConfigError) {
      return { kind: "config-missing", message: error.message };
    }
    throw error;
  }
}

function MissingConfigState({ message }: { message: string }) {
  return (
    <section className="panel empty-state" aria-labelledby="runs-config-title">
      <p className="panel-kicker">Configuration state</p>
      <h2 id="runs-config-title">Telemetry configuration needed</h2>
      <p>
        Add the server-side telemetry database setting for this read-only dashboard to load recent runs. The Runs page is available,
        but it will not attempt telemetry reads until the server-side configuration is present.
      </p>
      <p>{message}</p>
    </section>
  );
}

function RunsPanel({ overview }: { overview: TelemetryOverview }) {
  const runs = overview.recentRuns;
  const hasRuns = runs.length > 0;
  const windowLabel = `last ${overview.window.hours} hours`;

  return (
    <section className="panel" aria-labelledby="runs-table-title">
      <p className="panel-kicker">Run list</p>
      <h2 id="runs-table-title">{hasRuns ? "Live recent runs" : "No runs found"}</h2>
      <p>
        {hasRuns
          ? `${runs.length} recent runs from the configured telemetry source for the ${windowLabel}.`
          : `The configured telemetry schema is reachable, but it has no run rows for the ${windowLabel}.`}
      </p>
      {hasRuns ? <RunsTable runs={runs} windowLabel={windowLabel} /> : <EmptyRunsState />}
    </section>
  );
}

function EmptyRunsState() {
  return (
    <div className="empty-state" role="status">
      <strong>No telemetry runs are available yet.</strong>
      <p>When autospec records runs in the configured schema, the newest read-only rows will appear here.</p>
    </div>
  );
}

function RunsTable({ runs, windowLabel }: { runs: RecentRun[]; windowLabel: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Repository</th>
            <th>Branch</th>
            <th>Status</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Window</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{run.id && run.id !== "unknown" ? <a href={`/runs/${encodeURIComponent(run.id)}`}>{run.id}</a> : run.id}</td>
              <td>{run.repository}</td>
              <td>{run.branch}</td>
              <td><span className="status-pill">{run.status}</span></td>
              <td>{formatDateTime(run.startedAt)}</td>
              <td>{formatDuration(run)}</td>
              <td>{windowLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDateTime(value: Date | null): string {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(value);
}

function formatDuration(run: RecentRun): string {
  if (run.durationSeconds !== null) {
    return formatSeconds(run.durationSeconds);
  }
  if (run.startedAt && !run.endedAt) {
    return "In progress";
  }
  return "Unknown";
}

function formatSeconds(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}
