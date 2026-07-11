import TelemetryExplorer, { type TelemetryEvent } from "./telemetry-explorer";

type MetricPoint = {
  label: string;
  value: number;
  tone: "good" | "warn" | "neutral" | "bad";
};

type TrendPoint = {
  label: string;
  runs: number;
  merged: number;
  failed: number;
};

type AgentActivity = {
  phase: string;
  tier: string;
  issue: string;
  elapsed: string;
  outcome: string;
};

const runStatus: MetricPoint[] = [
  { label: "Succeeded", value: 42, tone: "good" },
  { label: "Running", value: 6, tone: "neutral" },
  { label: "Paused", value: 3, tone: "warn" },
  { label: "Failed", value: 4, tone: "bad" }
];

const issueThroughput: MetricPoint[] = [
  { label: "Created", value: 18, tone: "neutral" },
  { label: "Classified", value: 15, tone: "neutral" },
  { label: "Implemented", value: 11, tone: "good" },
  { label: "Merged", value: 9, tone: "good" },
  { label: "Failed", value: 2, tone: "bad" }
];

const prHealth: MetricPoint[] = [
  { label: "Open PRs", value: 7, tone: "neutral" },
  { label: "Merged PRs", value: 9, tone: "good" },
  { label: "Pending checks", value: 4, tone: "warn" },
  { label: "Failed checks", value: 1, tone: "bad" },
  { label: "Advisory checks", value: 3, tone: "neutral" }
];

const trend: TrendPoint[] = [
  { label: "00:00", runs: 5, merged: 1, failed: 0 },
  { label: "04:00", runs: 8, merged: 3, failed: 1 },
  { label: "08:00", runs: 11, merged: 5, failed: 1 },
  { label: "12:00", runs: 16, merged: 7, failed: 2 },
  { label: "16:00", runs: 13, merged: 9, failed: 3 },
  { label: "20:00", runs: 18, merged: 9, failed: 4 }
];

const agentActivity: AgentActivity[] = [
  { phase: "expand", tier: "frontier", issue: "#1", elapsed: "14m", outcome: "running" },
  { phase: "implement", tier: "standard", issue: "#8", elapsed: "37m", outcome: "merged" },
  { phase: "verify", tier: "spark", issue: "#12", elapsed: "9m", outcome: "clean" },
  { phase: "repair", tier: "standard", issue: "#5", elapsed: "22m", outcome: "paused" }
];


const telemetryEvents: TelemetryEvent[] = [
  { id: "run-42", category: "runs", label: "Run 42", status: "running", phase: "implement", repository: "berlinguyinca/autospec-gui", timestamp: "2026-07-11T06:00:00Z", detail: "Phase 4 implementer is updating telemetry dashboard controls.", value: 6 },
  { id: "issue-6", category: "issues", label: "Issue 6", status: "merged", phase: "verify", repository: "berlinguyinca/autospec-gui", timestamp: "2026-07-10T10:00:00Z", detail: "Interactive filters and drilldown controls reached review.", value: 11 },
  { id: "pr-4", category: "pull-requests", label: "PR 4", status: "failed", phase: "ci", repository: "berlinguyinca/autospec-gui", timestamp: "2026-07-09T08:00:00Z", detail: "Required check failure is grouped for investigation.", value: 1 },
  { id: "error-2", category: "errors", label: "Error 2", status: "paused", phase: "repair", repository: "autospec-core", timestamp: "2026-07-11T02:30:00Z", detail: "Validation timeout is visible without exposing recovery controls.", value: 3 },
  { id: "agent-1", category: "runs", label: "Agent 1", status: "clean", phase: "verify", repository: "autospec-core", timestamp: "2026-07-11T04:15:00Z", detail: "Verifier lane returned clean evidence for the selected run.", value: 9 }
];

const errors = [
  { message: "Validation timeout while waiting for checks", count: 3, latest: "18m ago", repo: "autospec-gui" },
  { message: "Telemetry schema missing optional PR health view", count: 1, latest: "42m ago", repo: "autospec-core" }
];

function total(points: MetricPoint[]) {
  return points.reduce((sum, point) => sum + point.value, 0);
}

function bars(points: MetricPoint[]) {
  const max = Math.max(...points.map((point) => point.value));

  return points.map((point, index) => {
    const width = (point.value / max) * 100;

    return (
      <div className="bar-row" data-testid="telemetry-metric" key={point.label}>
        <span>{point.label}</span>
        <div className="bar-track" aria-hidden="true">
          <span className={`bar-fill tone-${point.tone}`} style={{ width: `${width}%` }} />
        </div>
        <strong>{point.value}</strong>
        <span className="sr-only">rank {index + 1}</span>
      </div>
    );
  });
}

function Sparkline({ points }: { points: TrendPoint[] }) {
  const width = 360;
  const height = 140;
  const padding = 18;
  const max = Math.max(...points.flatMap((point) => [point.runs, point.merged, point.failed]));
  const x = (index: number) => padding + (index * (width - padding * 2)) / (points.length - 1);
  const y = (value: number) => height - padding - (value / max) * (height - padding * 2);
  const line = (field: keyof Pick<TrendPoint, "runs" | "merged" | "failed">) =>
    points.map((point, index) => `${x(index)},${y(point[field])}`).join(" ");

  return (
    <svg aria-label="Autospec run activity trend over the last 24 hours" className="chart" role="img" viewBox={`0 0 ${width} ${height}`}>
      <polyline className="chart-line runs" fill="none" points={line("runs")} />
      <polyline className="chart-line merged" fill="none" points={line("merged")} />
      <polyline className="chart-line failed" fill="none" points={line("failed")} />
      {points.map((point, index) => (
        <g key={point.label}>
          <circle className="chart-dot" cx={x(index)} cy={y(point.runs)} r="3" />
          <text x={x(index)} y={height - 4}>{point.label}</text>
        </g>
      ))}
    </svg>
  );
}

function Donut({ points, label }: { points: MetricPoint[]; label: string }) {
  const circumference = 100;
  let offset = 0;

  return (
    <svg aria-label={label} className="donut" role="img" viewBox="0 0 42 42">
      <circle className="donut-base" cx="21" cy="21" r="15.915" />
      {points.map((point) => {
        const length = (point.value / total(points)) * circumference;
        const segment = (
          <circle
            className={`donut-segment tone-${point.tone}`}
            cx="21"
            cy="21"
            key={point.label}
            r="15.915"
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-offset}
          />
        );
        offset += length;
        return segment;
      })}
      <text className="donut-total" x="21" y="23">{total(points)}</text>
    </svg>
  );
}

export default function Home() {
  return (
    <main className="shell" id="main-content">
      <section className="hero" aria-labelledby="dashboard-title">
        <p className="eyebrow">autospec-gui · read-only overview</p>
        <h1 id="dashboard-title">Overview telemetry</h1>
        <p>
          Last 24 hours of representative autospec activity, rendered from dynamic telemetry-like structures until the Postgres read model lands.
        </p>
      </section>

      <section className="summary-grid" aria-label="Telemetry summary">
        <article className="panel chart-panel">
          <div>
            <p className="panel-kicker">Run throughput</p>
            <h2>Activity trend</h2>
          </div>
          <Sparkline points={trend} />
          <ul className="legend" aria-label="Chart legend">
            <li><span className="legend-swatch runs" />Runs</li>
            <li><span className="legend-swatch merged" />Merged</li>
            <li><span className="legend-swatch failed" />Failed</li>
          </ul>
        </article>

        <article className="panel">
          <p className="panel-kicker">Status mix</p>
          <h2>{total(runStatus)} runs observed</h2>
          <Donut label="Run status distribution" points={runStatus} />
          <div className="metric-list">{bars(runStatus)}</div>
        </article>

        <article className="panel">
          <p className="panel-kicker">Issue throughput</p>
          <h2>{total(issueThroughput)} issue events</h2>
          <div className="metric-list">{bars(issueThroughput)}</div>
        </article>

        <article className="panel">
          <p className="panel-kicker">PR/CI health</p>
          <h2>{total(prHealth)} pull request signals</h2>
          <Donut label="Pull request and CI health distribution" points={prHealth} />
          <div className="metric-list">{bars(prHealth)}</div>
        </article>
      </section>

      <TelemetryExplorer events={telemetryEvents} />

      <section className="detail-grid" aria-label="Operational detail">
        <article className="panel">
          <p className="panel-kicker">Agent activity</p>
          <h2>Current phase lanes</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Phase</th>
                  <th>Tier</th>
                  <th>Issue</th>
                  <th>Elapsed</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {agentActivity.map((agent) => (
                  <tr key={`${agent.phase}-${agent.issue}`}>
                    <td>{agent.phase}</td>
                    <td>{agent.tier}</td>
                    <td>{agent.issue}</td>
                    <td>{agent.elapsed}</td>
                    <td><span className="status-pill">{agent.outcome}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <p className="panel-kicker">Error summary</p>
          <h2>Grouped failures</h2>
          <ul className="error-list">
            {errors.map((error) => (
              <li key={error.message}>
                <strong>{error.message}</strong>
                <span>{error.count} occurrences · latest {error.latest} · {error.repo}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
