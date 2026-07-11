"use client";

import { useMemo, useState } from "react";

export type TelemetryCategory = "all" | "runs" | "issues" | "pull-requests" | "errors";
export type TelemetryStatus = "all" | "running" | "merged" | "failed" | "paused" | "clean";

export type TelemetryEvent = {
  id: string;
  category: Exclude<TelemetryCategory, "all">;
  label: string;
  status: Exclude<TelemetryStatus, "all">;
  phase: string;
  repository: string;
  timestamp: string;
  detail: string;
  value: number;
};

export type TelemetryFilters = {
  category: TelemetryCategory;
  status: TelemetryStatus;
  windowHours: number;
  repository: string;
};

export type TelemetrySummary = {
  total: number;
  running: number;
  merged: number;
  failed: number;
};

const DEFAULT_FILTERS: TelemetryFilters = {
  category: "all",
  status: "all",
  windowHours: 24,
  repository: "all"
};

const statusLabels: Record<TelemetryStatus, string> = {
  all: "All statuses",
  running: "Running",
  merged: "Merged",
  failed: "Failed",
  paused: "Paused",
  clean: "Clean"
};

const categoryLabels: Record<TelemetryCategory, string> = {
  all: "All telemetry",
  runs: "Runs",
  issues: "Issues",
  "pull-requests": "Pull requests",
  errors: "Errors"
};

export function filterTelemetryEvents(events: TelemetryEvent[], filters: TelemetryFilters): TelemetryEvent[] {
  const windowStart = Date.now() - filters.windowHours * 60 * 60 * 1000;

  return events.filter((event) => {
    const eventTime = Date.parse(event.timestamp);
    return (
      (filters.category === "all" || event.category === filters.category) &&
      (filters.status === "all" || event.status === filters.status) &&
      (filters.repository === "all" || event.repository === filters.repository) &&
      Number.isFinite(eventTime) &&
      eventTime >= windowStart
    );
  });
}

export function summarizeVisibleEvents(events: TelemetryEvent[]): TelemetrySummary {
  return events.reduce<TelemetrySummary>(
    (summary, event) => ({
      total: summary.total + 1,
      running: summary.running + (event.status === "running" ? 1 : 0),
      merged: summary.merged + (event.status === "merged" ? 1 : 0),
      failed: summary.failed + (event.status === "failed" ? 1 : 0)
    }),
    { total: 0, running: 0, merged: 0, failed: 0 }
  );
}

export default function TelemetryExplorer({ events }: { events: TelemetryEvent[] }) {
  const [filters, setFilters] = useState<TelemetryFilters>(DEFAULT_FILTERS);
  const [activeEventId, setActiveEventId] = useState(events[0]?.id ?? "");

  const repositories = useMemo(() => Array.from(new Set(events.map((event) => event.repository))).sort(), [events]);
  const visibleEvents = useMemo(() => filterTelemetryEvents(events, filters), [events, filters]);
  const summary = summarizeVisibleEvents(visibleEvents);
  const activeEvent = visibleEvents.find((event) => event.id === activeEventId) ?? visibleEvents[0] ?? null;
  const maxValue = Math.max(1, ...visibleEvents.map((event) => event.value));

  function updateFilter<Key extends keyof TelemetryFilters>(key: Key, value: TelemetryFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="panel explorer-panel" aria-labelledby="telemetry-explorer-title">
      <div className="explorer-heading">
        <div>
          <p className="panel-kicker">Interactive telemetry</p>
          <h2 id="telemetry-explorer-title">Filters and drilldown</h2>
        </div>
        <p className="read-only-note">Read-only browser controls; no mutation paths are exposed.</p>
      </div>

      <div className="filter-grid" aria-label="Telemetry filters">
        <label>
          <span>Category</span>
          <select
            aria-label="Telemetry category"
            value={filters.category}
            onChange={(event) => updateFilter("category", event.target.value as TelemetryCategory)}
          >
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Status</span>
          <select
            aria-label="Telemetry status"
            value={filters.status}
            onChange={(event) => updateFilter("status", event.target.value as TelemetryStatus)}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Window</span>
          <select
            aria-label="Telemetry time window"
            value={filters.windowHours}
            onChange={(event) => updateFilter("windowHours", Number(event.target.value))}
          >
            <option value={6}>Last 6 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={72}>Last 72 hours</option>
          </select>
        </label>

        <label>
          <span>Repository</span>
          <select
            aria-label="Telemetry repository"
            value={filters.repository}
            onChange={(event) => updateFilter("repository", event.target.value)}
          >
            <option value="all">All repositories</option>
            {repositories.map((repository) => (
              <option key={repository} value={repository}>{repository}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="summary-strip" aria-label="Filtered telemetry summary">
        <span><strong>{summary.total}</strong> visible</span>
        <span><strong>{summary.running}</strong> running</span>
        <span><strong>{summary.merged}</strong> merged</span>
        <span><strong>{summary.failed}</strong> failed</span>
      </div>

      <div className="drilldown-layout">
        <svg className="interactive-chart" role="img" aria-label="Filtered telemetry event volume" viewBox="0 0 360 150">
          {visibleEvents.map((event, index) => {
            const barHeight = (event.value / maxValue) * 104;
            const x = 18 + index * 54;
            const y = 126 - barHeight;
            return (
              <g key={event.id}>
                <rect className={`chart-bar tone-${event.status}`} x={x} y={y} width="32" height={barHeight} rx="6" />
                <text x={x + 16} y="144">{event.label}</text>
              </g>
            );
          })}
        </svg>

        <div className="drilldown-list" aria-label="Telemetry drilldown controls">
          {visibleEvents.map((event) => (
            <button
              aria-pressed={activeEvent?.id === event.id}
              className="drilldown-button"
              data-testid="telemetry-drilldown-row"
              key={event.id}
              onClick={() => setActiveEventId(event.id)}
              type="button"
            >
              <span>{event.label}</span>
              <strong>{event.status}</strong>
            </button>
          ))}
        </div>
      </div>

      {activeEvent ? (
        <article className="drilldown-detail" aria-live="polite" aria-label="Selected telemetry detail">
          <p className="panel-kicker">Selected detail</p>
          <h3>{activeEvent.label}</h3>
          <dl>
            <div><dt>Repository</dt><dd>{activeEvent.repository}</dd></div>
            <div><dt>Phase</dt><dd>{activeEvent.phase}</dd></div>
            <div><dt>Status</dt><dd>{activeEvent.status}</dd></div>
            <div><dt>Observed</dt><dd>{new Date(activeEvent.timestamp).toLocaleString("en-US", { timeZone: "UTC" })} UTC</dd></div>
          </dl>
          <p>{activeEvent.detail}</p>
        </article>
      ) : (
        <p className="empty-state">No telemetry matches the current filters.</p>
      )}
    </section>
  );
}
