import "server-only";

import { getAutospecServerConfig } from "./config";
import { quoteIdentifier, withReadOnlyTelemetryClient, type ReadOnlyTelemetryClient } from "./db";

export type TelemetryTimeWindow = {
  hours: number;
  from: Date;
  to: Date;
};

export type RunStatusCount = {
  status: string;
  count: number;
};

export type RecentRun = {
  id: string;
  repository: string;
  branch: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
};

export type IssueThroughput = {
  created: number;
  classified: number;
  implemented: number;
  merged: number;
  failed: number;
  paused: number;
};

export type PullRequestHealth = {
  open: number;
  merged: number;
  failedChecks: number;
  pendingChecks: number;
  advisoryChecks: number;
};

export type AgentActivity = {
  phase: string;
  modelTier: string;
  issueNumber: number | null;
  elapsedSeconds: number | null;
  outcome: string;
};

export type ErrorSummary = {
  message: string;
  count: number;
  latestOccurrence: Date | null;
  runId: string | null;
  repository: string;
};

export type TelemetryOverview = {
  window: TelemetryTimeWindow;
  runStatusCounts: RunStatusCount[];
  recentRuns: RecentRun[];
  issueThroughput: IssueThroughput;
  pullRequestHealth: PullRequestHealth;
  agentActivity: AgentActivity[];
  errorSummary: ErrorSummary[];
};

export type TelemetryColumn = {
  tableName: string;
  columnName: string;
  dataType: string;
};

export type DiscoveredTelemetrySchema = {
  schemaName: string;
  tables: Record<string, string[]>;
};

type TableRef = {
  name: string;
  columns: Set<string>;
};

const RUN_TABLES = ["autospec_runs", "runs", "run_state"];
const EVENT_TABLES = ["autospec_events", "events", "telemetry_events"];
const PR_TABLES = ["pull_requests", "prs", "github_pull_requests"];
const AGENT_TABLES = ["agent_activity", "agents", "worker_activity"];
const ERROR_TABLES = ["errors", "error_events", "failures"];

export async function discoverTelemetrySchema(
  client: ReadOnlyTelemetryClient,
  schemaName = "public"
): Promise<DiscoveredTelemetrySchema> {
  const result = await client.query<TelemetryColumn>(
    `select table_name as "tableName", column_name as "columnName", data_type as "dataType"
       from information_schema.columns
      where table_schema = $1
      order by table_name, ordinal_position`,
    [schemaName]
  );

  const tables: Record<string, string[]> = {};
  for (const row of result.rows) {
    tables[row.tableName] ??= [];
    tables[row.tableName].push(row.columnName);
  }

  return { schemaName, tables };
}

export async function getTelemetryOverview(hours = 24): Promise<TelemetryOverview> {
  const config = getAutospecServerConfig();
  return withReadOnlyTelemetryClient(async (client) => {
    const discovered = await discoverTelemetrySchema(client, config.telemetrySchema);
    const window = buildWindow(hours);

    const [runStatusCounts, recentRuns, issueThroughput, pullRequestHealth, agentActivity, errorSummary] = await Promise.all([
      listRunStatusCounts(client, discovered, window),
      listRecentRuns(client, discovered, window),
      getIssueThroughput(client, discovered, window),
      getPullRequestHealth(client, discovered, window),
      listAgentActivity(client, discovered, window),
      listErrorSummary(client, discovered, window)
    ]);

    return { window, runStatusCounts, recentRuns, issueThroughput, pullRequestHealth, agentActivity, errorSummary };
  }, config);
}

export async function listRecentRuns(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  window: TelemetryTimeWindow = buildWindow(24),
  limit = 25
): Promise<RecentRun[]> {
  const table = findTable(discovered, RUN_TABLES);
  if (!table) return [];

  const id = pickColumn(table, ["id", "run_id", "dispatch_id"]);
  const repository = pickColumn(table, ["repository", "repo", "repo_name", "name_with_owner"]);
  const branch = pickColumn(table, ["branch", "head_branch", "ref"]);
  const status = pickColumn(table, ["status", "state", "outcome"]);
  const startedAt = pickColumn(table, ["started_at", "created_at", "claimed_at", "ts"]);
  const endedAt = pickColumn(table, ["ended_at", "finished_at", "merged_at", "updated_at"]);

  const rows = await client.query<{
    id: string | null;
    repository: string | null;
    branch: string | null;
    status: string | null;
    startedAt: Date | string | null;
    endedAt: Date | string | null;
    durationSeconds: string | number | null;
  }>(
    `select ${textExpr(id, "unknown")} as id,
            ${textExpr(repository, "unknown")} as repository,
            ${textExpr(branch, "unknown")} as branch,
            ${textExpr(status, "unknown")} as status,
            ${dateExpr(startedAt)} as "startedAt",
            ${dateExpr(endedAt)} as "endedAt",
            case when ${columnExpr(startedAt)} is not null and ${columnExpr(endedAt)} is not null
                 then extract(epoch from (${columnExpr(endedAt)}::timestamptz - ${columnExpr(startedAt)}::timestamptz))
                 else null end as "durationSeconds"
       from ${quoteIdentifier(table.name)}
      where ${windowPredicate(startedAt)}
      order by ${orderExpr(startedAt)} desc
      limit $2`,
    [window.from.toISOString(), limit]
  );

  return rows.rows.map((row) => ({
    id: row.id ?? "unknown",
    repository: row.repository ?? "unknown",
    branch: row.branch ?? "unknown",
    status: row.status ?? "unknown",
    startedAt: coerceDate(row.startedAt),
    endedAt: coerceDate(row.endedAt),
    durationSeconds: coerceNumber(row.durationSeconds)
  }));
}

async function listRunStatusCounts(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  window: TelemetryTimeWindow
): Promise<RunStatusCount[]> {
  const table = findTable(discovered, RUN_TABLES);
  if (!table) return [];

  const status = pickColumn(table, ["status", "state", "outcome"]);
  const startedAt = pickColumn(table, ["started_at", "created_at", "claimed_at", "ts"]);

  const rows = await client.query<{ status: string | null; count: string | number }>(
    `select ${textExpr(status, "unknown")} as status, count(*)::int as count
       from ${quoteIdentifier(table.name)}
      where ${windowPredicate(startedAt)}
      group by 1
      order by count desc, status asc`,
    [window.from.toISOString()]
  );

  return rows.rows.map((row) => ({ status: row.status ?? "unknown", count: coerceNumber(row.count) ?? 0 }));
}

async function getIssueThroughput(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  window: TelemetryTimeWindow
): Promise<IssueThroughput> {
  const table = findTable(discovered, EVENT_TABLES);
  if (!table) return emptyIssueThroughput();

  const kind = pickColumn(table, ["event_type", "type", "event", "status", "state"]);
  const happenedAt = pickColumn(table, ["created_at", "ts", "timestamp", "happened_at"]);

  const rows = await client.query<{ bucket: string | null; count: string | number }>(
    `select lower(${textExpr(kind, "unknown")}) as bucket, count(*)::int as count
       from ${quoteIdentifier(table.name)}
      where ${windowPredicate(happenedAt)}
      group by 1`,
    [window.from.toISOString()]
  );

  return countBuckets(rows.rows, {
    created: ["issue_created", "created"],
    classified: ["classified", "issue_classified"],
    implemented: ["implemented", "implementation"],
    merged: ["merged", "pr_merged"],
    failed: ["failed", "error"],
    paused: ["paused", "blocked"]
  });
}

async function getPullRequestHealth(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  window: TelemetryTimeWindow
): Promise<PullRequestHealth> {
  const table = findTable(discovered, PR_TABLES);
  if (!table) return { open: 0, merged: 0, failedChecks: 0, pendingChecks: 0, advisoryChecks: 0 };

  const status = pickColumn(table, ["status", "state", "merge_state"]);
  const checkStatus = pickColumn(table, ["check_status", "ci_status", "checks_status"]);
  const advisory = pickColumn(table, ["advisory", "is_advisory", "advisory_check"]);
  const updatedAt = pickColumn(table, ["updated_at", "created_at", "ts", "merged_at"]);

  const rows = await client.query<PullRequestHealth>(
    `select count(*) filter (where lower(${textExpr(status, "")}) = 'open')::int as open,
            count(*) filter (where lower(${textExpr(status, "")}) = 'merged')::int as merged,
            count(*) filter (where lower(${textExpr(checkStatus, "")}) = 'failed')::int as "failedChecks",
            count(*) filter (where lower(${textExpr(checkStatus, "")}) = 'pending')::int as "pendingChecks",
            count(*) filter (where ${booleanExpr(advisory)})::int as "advisoryChecks"
       from ${quoteIdentifier(table.name)}
      where ${windowPredicate(updatedAt)}`,
    [window.from.toISOString()]
  );

  return rows.rows[0] ?? { open: 0, merged: 0, failedChecks: 0, pendingChecks: 0, advisoryChecks: 0 };
}

async function listAgentActivity(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  window: TelemetryTimeWindow
): Promise<AgentActivity[]> {
  const table = findTable(discovered, AGENT_TABLES);
  if (!table) return [];

  const phase = pickColumn(table, ["phase", "step", "lane"]);
  const modelTier = pickColumn(table, ["model_tier", "tier", "model"]);
  const issueNumber = pickColumn(table, ["issue_number", "issue"]);
  const elapsedSeconds = pickColumn(table, ["elapsed_seconds", "duration_seconds", "elapsed"]);
  const outcome = pickColumn(table, ["outcome", "status", "state"]);
  const updatedAt = pickColumn(table, ["updated_at", "created_at", "ts", "started_at"]);

  const rows = await client.query<AgentActivity>(
    `select ${textExpr(phase, "unknown")} as phase,
            ${textExpr(modelTier, "unknown")} as "modelTier",
            ${numberExpr(issueNumber)} as "issueNumber",
            ${numberExpr(elapsedSeconds)} as "elapsedSeconds",
            ${textExpr(outcome, "unknown")} as outcome
       from ${quoteIdentifier(table.name)}
      where ${windowPredicate(updatedAt)}
      order by ${orderExpr(updatedAt)} desc
      limit 25`,
    [window.from.toISOString()]
  );

  return rows.rows;
}

async function listErrorSummary(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  window: TelemetryTimeWindow
): Promise<ErrorSummary[]> {
  const table = findTable(discovered, ERROR_TABLES) ?? findTable(discovered, EVENT_TABLES);
  if (!table) return [];

  const message = pickColumn(table, ["message", "error_message", "failure", "details"]);
  const repository = pickColumn(table, ["repository", "repo", "repo_name", "name_with_owner"]);
  const runId = pickColumn(table, ["run_id", "dispatch_id", "id"]);
  const happenedAt = pickColumn(table, ["created_at", "ts", "timestamp", "happened_at"]);

  const rows = await client.query<ErrorSummary>(
    `select ${textExpr(message, "unknown failure")} as message,
            count(*)::int as count,
            max(${dateExpr(happenedAt)}) as "latestOccurrence",
            min(${textExpr(runId, "")}) as "runId",
            ${textExpr(repository, "unknown")} as repository
       from ${quoteIdentifier(table.name)}
      where ${windowPredicate(happenedAt)}
        and lower(${textExpr(message, "")}) <> ''
      group by 1, 5
      order by count desc, "latestOccurrence" desc
      limit 25`,
    [window.from.toISOString()]
  );

  return rows.rows.map((row) => ({ ...row, latestOccurrence: coerceDate(row.latestOccurrence), runId: row.runId || null }));
}

function buildWindow(hours: number): TelemetryTimeWindow {
  const to = new Date();
  const from = new Date(to.getTime() - Math.max(1, hours) * 60 * 60 * 1000);
  return { hours: Math.max(1, hours), from, to };
}

function findTable(discovered: DiscoveredTelemetrySchema, candidates: readonly string[]): TableRef | null {
  for (const name of candidates) {
    const columns = discovered.tables[name];
    if (columns) return { name, columns: new Set(columns) };
  }
  return null;
}

function pickColumn(table: TableRef, candidates: readonly string[]): string | null {
  return candidates.find((column) => table.columns.has(column)) ?? null;
}

function columnExpr(column: string | null): string {
  return column ? quoteIdentifier(column) : "null";
}

function textExpr(column: string | null, fallback: string): string {
  return `coalesce(${columnExpr(column)}::text, '${fallback.replaceAll("'", "''")}')`;
}

function dateExpr(column: string | null): string {
  return column ? `${quoteIdentifier(column)}::timestamptz` : "null::timestamptz";
}

function numberExpr(column: string | null): string {
  return column ? `${quoteIdentifier(column)}::numeric` : "null::numeric";
}

function booleanExpr(column: string | null): string {
  return column ? `${quoteIdentifier(column)}::boolean` : "false";
}

function windowPredicate(column: string | null): string {
  return column ? `${quoteIdentifier(column)}::timestamptz >= $1::timestamptz` : "true";
}

function orderExpr(column: string | null): string {
  return column ? `${quoteIdentifier(column)}::timestamptz` : "now()";
}

function coerceDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function coerceNumber(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === "number" ? value : Number(value);
}

function emptyIssueThroughput(): IssueThroughput {
  return { created: 0, classified: 0, implemented: 0, merged: 0, failed: 0, paused: 0 };
}

function countBuckets(rows: Array<{ bucket: string | null; count: string | number }>, aliases: Record<keyof IssueThroughput, string[]>): IssueThroughput {
  const counts = emptyIssueThroughput();
  for (const row of rows) {
    const bucket = row.bucket ?? "";
    for (const [key, values] of Object.entries(aliases) as Array<[keyof IssueThroughput, string[]]>) {
      if (values.some((value) => bucket.includes(value))) {
        counts[key] += coerceNumber(row.count) ?? 0;
      }
    }
  }
  return counts;
}
