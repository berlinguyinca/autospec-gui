import { AutospecConfigError } from "../../src/server/config";
import {
  getPullRequestDrilldowns,
  type PullRequestDrilldown,
  type PullRequestDrilldownFilters
} from "../../src/server/telemetry";

export const dynamic = "force-dynamic";

type PullRequestsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type PullRequestsPageState =
  | { kind: "ready"; filters: PullRequestDrilldownFilters; rows: PullRequestDrilldown[] }
  | { kind: "config-missing"; message: string };

const WINDOW_OPTIONS = [6, 24, 72, 168] as const;
const STATUS_OPTIONS = ["all", "open", "merged", "failed", "pending", "blocked", "unknown"] as const;
const FAILURE_CLASS_OPTIONS = ["all", "validation", "check", "merge", "configuration", "timeout", "unknown"] as const;

export default async function PullRequestsPage({ searchParams }: PullRequestsPageProps = {}) {
  const filters = parsePullRequestFilters(await searchParams);
  const state = await getPullRequestsPageState(filters);

  return (
    <main className="shell section-shell" id="main-content">
      <section className="hero" aria-labelledby="pull-requests-title">
        <p className="eyebrow">read-only autospec telemetry</p>
        <h1 id="pull-requests-title">Pull Requests</h1>
        <p>Pull request drilldowns show PR, check, validation, issue, branch, and merge-state telemetry without write controls.</p>
      </section>

      {state.kind === "config-missing" ? <MissingConfigState message={state.message} /> : <PullRequestPanel filters={state.filters} rows={state.rows} />}
    </main>
  );
}

async function getPullRequestsPageState(filters: PullRequestDrilldownFilters): Promise<PullRequestsPageState> {
  try {
    return { kind: "ready", filters, rows: await getPullRequestDrilldowns(filters) };
  } catch (error) {
    if (error instanceof AutospecConfigError) {
      return { kind: "config-missing", message: error.message };
    }
    throw error;
  }
}

export function parsePullRequestFilters(params: Record<string, string | string[] | undefined> | undefined): PullRequestDrilldownFilters {
  const repository = firstParam(params?.repository)?.trim() || "all";
  const status = parseOption(firstParam(params?.status), STATUS_OPTIONS, "all");
  const failureClass = parseOption(firstParam(params?.failureClass), FAILURE_CLASS_OPTIONS, "all");
  const windowParam = Number(firstParam(params?.window));
  const windowHours = WINDOW_OPTIONS.includes(windowParam as (typeof WINDOW_OPTIONS)[number]) ? windowParam : 24;

  return { repository, status, windowHours, failureClass };
}

export function buildPullRequestFilterHref(
  current: PullRequestDrilldownFilters,
  patch: Partial<PullRequestDrilldownFilters>
): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.repository !== "all") params.set("repository", next.repository);
  if (next.status !== "all") params.set("status", next.status);
  if (next.windowHours !== 24) params.set("window", String(next.windowHours));
  if (next.failureClass !== "all") params.set("failureClass", next.failureClass);
  const query = params.toString();
  return query ? `/pull-requests?${query}` : "/pull-requests";
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseOption<T extends readonly string[]>(value: string | undefined, options: T, fallback: T[number]): T[number] {
  return options.includes((value ?? "") as T[number]) ? (value as T[number]) : fallback;
}

function MissingConfigState({ message }: { message: string }) {
  return (
    <section className="panel empty-state" aria-labelledby="pr-config-title">
      <p className="panel-kicker">Configuration state</p>
      <h2 id="pr-config-title">Telemetry configuration needed</h2>
      <p>
        Add the server-side telemetry database setting for this read-only dashboard to load pull request and check rows.
        This page does not attempt client-side telemetry access or expose connection settings.
      </p>
      <p>{message}</p>
    </section>
  );
}

function PullRequestPanel({ filters, rows }: { filters: PullRequestDrilldownFilters; rows: PullRequestDrilldown[] }) {
  const windowLabel = `last ${filters.windowHours} hours`;

  return (
    <>
      <section className="panel" aria-labelledby="pr-filter-title">
        <p className="panel-kicker">URL-backed filters</p>
        <h2 id="pr-filter-title">Pull request filters</h2>
        <p>Reader-selected filters are encoded in the URL so repository, status, time range, and failure class drilldowns can be shared.</p>
        <div className="filter-grid" aria-label="Pull request filters">
          <FilterGroup label="Repository" values={["all", ...uniqueRepositories(rows, filters.repository)]} active={filters.repository} param="repository" filters={filters} />
          <FilterGroup label="Status" values={STATUS_OPTIONS} active={filters.status} param="status" filters={filters} />
          <FilterGroup label="Time range" values={WINDOW_OPTIONS.map(String)} active={String(filters.windowHours)} param="window" filters={filters} />
          <FilterGroup label="Failure class" values={FAILURE_CLASS_OPTIONS} active={filters.failureClass} param="failureClass" filters={filters} />
        </div>
      </section>

      <section className="panel" aria-labelledby="pr-drilldown-title">
        <p className="panel-kicker">PR/check detail</p>
        <h2 id="pr-drilldown-title">{rows.length > 0 ? "Filtered PR/check rows" : "No pull request check rows found"}</h2>
        <p>
          {rows.length > 0
            ? `${rows.length} pull request check rows match the active filters for the ${windowLabel}.`
            : `The configured telemetry source has no pull request or check rows for the ${windowLabel}. Adjust the URL-backed filters or wait for telemetry to arrive.`}
        </p>
        {rows.length > 0 ? <PullRequestRows rows={rows} /> : <EmptyPullRequestState />}
      </section>
    </>
  );
}

function FilterGroup({
  label,
  values,
  active,
  param,
  filters
}: {
  label: string;
  values: readonly string[];
  active: string;
  param: "repository" | "status" | "window" | "failureClass";
  filters: PullRequestDrilldownFilters;
}) {
  return (
    <div>
      <strong>{label}</strong>
      <ul className="inline-link-list">
        {values.map((value) => {
          const patch = param === "window" ? { windowHours: Number(value) } : { [param]: value };
          return (
            <li key={`${param}-${value}`}>
              <a className={value === active ? "filter-link active" : "filter-link"} href={buildPullRequestFilterHref(filters, patch)}>
                {formatFilterLabel(value, param)}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PullRequestRows({ rows }: { rows: PullRequestDrilldown[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pull request</th>
            <th>Repository</th>
            <th>Status</th>
            <th>Check status</th>
            <th>Validation summary</th>
            <th>Linked issue</th>
            <th>Branch</th>
            <th>Merge state</th>
            <th>Failure class</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <strong>{formatPullRequestLabel(row)}</strong>
                <span className="cell-note">{row.title ?? "Missing title"}</span>
                <ExternalTelemetryLink href={row.url} label="View PR" unavailableLabel="PR URL unavailable" />
              </td>
              <td>{row.repository}</td>
              <td><span className="status-pill">{row.status}</span></td>
              <td>
                {row.checkStatus ?? "No check status recorded"}
                <ExternalTelemetryLink href={row.checkUrl} label="View check run" unavailableLabel="Check URL unavailable" />
              </td>
              <td>{row.validationSummary ?? "No validation summary recorded"}</td>
              <td>{row.linkedIssueNumber === null ? "No linked issue recorded" : `Issue #${row.linkedIssueNumber}`}</td>
              <td>{row.branch ?? "No branch recorded"}</td>
              <td>{row.mergeState ?? "No merge state recorded"}</td>
              <td>{row.failureClass ?? "No failure class recorded"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function ExternalTelemetryLink({ href, label, unavailableLabel }: { href: string | null; label: string; unavailableLabel: string }) {
  const safeHref = safeHttpUrl(href);
  return (
    <span className="cell-note">
      {safeHref ? <a href={safeHref}>{label}</a> : unavailableLabel}
    </span>
  );
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function EmptyPullRequestState() {
  return (
    <div className="empty-state" role="status">
      <strong>No pull request check rows are available for the active filters.</strong>
      <p>Missing optional PR, check, validation, branch, issue, or merge fields are non-fatal and render as unavailable when rows exist.</p>
    </div>
  );
}

function uniqueRepositories(rows: PullRequestDrilldown[], activeRepository: string): string[] {
  return Array.from(new Set([activeRepository, ...rows.map((row) => row.repository)].filter((value) => value && value !== "all"))).sort();
}

function formatFilterLabel(value: string, param: string): string {
  if (param === "window") return `${value}h`;
  return value === "all" ? "All" : value.replaceAll("_", " ");
}

function formatPullRequestLabel(row: PullRequestDrilldown): string {
  if (row.number !== null) return `PR #${row.number}`;
  return row.id === "unknown" ? "Unknown PR" : row.id;
}
