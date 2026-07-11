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

export type RunSummary = RecentRun & {
  issueNumber: number | null;
  pullRequestNumber: number | null;
};

export type RunPhase = {
  name: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  summary: string;
};

export type ValidationEvidence = {
  name: string;
  status: string;
  evidence: string;
  checkedAt: Date | null;
};

export type RunRelatedError = {
  message: string;
  count: number;
  latestOccurrence: Date | null;
};

export type RunDetail = {
  run: RunSummary;
  phases: RunPhase[];
  validations: ValidationEvidence[];
  errors: RunRelatedError[];
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

export type AutonomousRunStatus = {
  id: string;
  repository: string;
  branch: string | null;
  status: string;
  heartbeatAt: Date | null;
  heartbeatAgeSeconds: number | null;
  phase: string | null;
  cycle: string | null;
  issueNumber: number | null;
  observedAt: Date | null;
};

type AutonomousRunStatusRow = {
  id: string | null;
  repository: string | null;
  branch: string | null;
  status: string | null;
  heartbeatAt: Date | string | null;
  phase: string | null;
  cycle: string | number | null;
  issueNumber: string | null;
  observedAt: Date | string | null;
};

export type TelemetryOverview = {
  window: TelemetryTimeWindow;
  runStatusCounts: RunStatusCount[];
  recentRuns: RecentRun[];
  issueThroughput: IssueThroughput;
  pullRequestHealth: PullRequestHealth;
  agentActivity: AgentActivity[];
  errorSummary: ErrorSummary[];
  autonomousRunStatus: AutonomousRunStatus | null;
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
const HEARTBEAT_COLUMNS = ["heartbeat_at", "last_heartbeat_at", "heartbeat_ts", "last_seen_at"];

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

    const [runStatusCounts, recentRuns, issueThroughput, pullRequestHealth, agentActivity, errorSummary, autonomousRunStatus] = await Promise.all([
      listRunStatusCounts(client, discovered, window),
      listRecentRuns(client, discovered, window),
      getIssueThroughput(client, discovered, window),
      getPullRequestHealth(client, discovered, window),
      listAgentActivity(client, discovered, window),
      listErrorSummary(client, discovered, window),
      getLatestAutonomousRunStatus(client, discovered)
    ]);

    return { window, runStatusCounts, recentRuns, issueThroughput, pullRequestHealth, agentActivity, errorSummary, autonomousRunStatus };
  }, config);
}


export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  const config = getAutospecServerConfig();
  return withReadOnlyTelemetryClient(async (client) => {
    const discovered = await discoverTelemetrySchema(client, config.telemetrySchema);
    const run = await getRunSummary(client, discovered, runId);
    if (!run) return null;

    const [phases, validations, errors] = await Promise.all([
      listRunPhases(client, discovered, runId),
      listValidationEvidence(client, discovered, runId),
      listRunRelatedErrors(client, discovered, runId)
    ]);

    return { run, phases, validations, errors };
  }, config);
}


export async function getLatestAutonomousRunStatus(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  now = new Date()
): Promise<AutonomousRunStatus | null> {
  const table = findTable(discovered, RUN_TABLES);
  if (!table) return null;

  const id = pickColumn(table, ["id", "run_id", "dispatch_id"]);
  const repository = pickColumn(table, ["repository", "repo", "repo_name", "name_with_owner"]);
  const branch = pickColumn(table, ["branch", "head_branch", "ref"]);
  const status = pickColumn(table, ["status", "state", "outcome"]);
  const heartbeatAt = pickColumn(table, HEARTBEAT_COLUMNS);
  const phase = pickColumn(table, ["phase", "current_phase", "step", "current_step", "lane"]);
  const cycle = pickColumn(table, ["cycle", "current_cycle", "cycle_number", "iteration", "round"]);
  const issueNumber = pickColumn(table, ["issue_number", "issue", "github_issue_number", "active_issue"]);
  const observedAt = pickColumn(table, ["updated_at", "started_at", "created_at", "claimed_at", "ts", "timestamp"]);
  const latestOrder = recencyOrderExpr(heartbeatAt, observedAt);

  const rows = await client.query<AutonomousRunStatusRow>(
    `select ${textExpr(id, "unknown")} as id,
            ${textExpr(repository, "unknown")} as repository,
            ${nullableTextExpr(branch)} as branch,
            ${textExpr(status, "unknown")} as status,
            ${dateExpr(heartbeatAt)} as "heartbeatAt",
            ${nullableTextExpr(phase)} as phase,
            ${nullableTextExpr(cycle)} as cycle,
            ${nullableTextExpr(issueNumber)} as "issueNumber",
            ${dateExpr(observedAt)} as "observedAt"
       from ${quoteIdentifier(table.name)}
      order by ${latestOrder}
      limit 1`
  );

  return shapeAutonomousRunStatus(rows.rows[0] ?? null, now);
}

export function shapeAutonomousRunStatus(row: AutonomousRunStatusRow | null, now = new Date()): AutonomousRunStatus | null {
  if (!row) return null;

  const heartbeatAt = coerceDate(row.heartbeatAt);
  const heartbeatAgeSeconds = heartbeatAt ? Math.max(0, Math.round((now.getTime() - heartbeatAt.getTime()) / 1000)) : null;

  return {
    id: row.id ?? "unknown",
    repository: row.repository ?? "unknown",
    branch: emptyToNull(row.branch),
    status: row.status ?? "unknown",
    heartbeatAt,
    heartbeatAgeSeconds,
    phase: emptyToNull(row.phase),
    cycle: emptyToNull(row.cycle === null ? null : String(row.cycle)),
    issueNumber: parseIssueNumber(row.issueNumber),
    observedAt: coerceDate(row.observedAt)
  };
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


async function getRunSummary(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  runIdValue: string
): Promise<RunSummary | null> {
  const table = findTable(discovered, RUN_TABLES);
  if (!table) return null;

  const id = pickColumn(table, ["id", "run_id", "dispatch_id"]);
  if (!id) return null;

  const repository = pickColumn(table, ["repository", "repo", "repo_name", "name_with_owner"]);
  const branch = pickColumn(table, ["branch", "head_branch", "ref"]);
  const status = pickColumn(table, ["status", "state", "outcome"]);
  const startedAt = pickColumn(table, ["started_at", "claimed_at", "ts", "timestamp"]);
  const endedAt = pickColumn(table, ["ended_at", "finished_at", "merged_at", "updated_at"]);
  const issueNumber = pickColumn(table, ["issue_number", "issue", "github_issue_number"]);
  const pullRequestNumber = pickColumn(table, ["pull_request_number", "pr_number", "pr", "github_pr_number"]);

  const rows = await client.query<{
    id: string | null;
    repository: string | null;
    branch: string | null;
    status: string | null;
    startedAt: Date | string | null;
    endedAt: Date | string | null;
    durationSeconds: string | number | null;
    issueNumber: string | number | null;
    pullRequestNumber: string | number | null;
  }>(
    `select ${textExpr(id, "unknown")} as id,
            ${textExpr(repository, "unknown")} as repository,
            ${textExpr(branch, "unknown")} as branch,
            ${textExpr(status, "unknown")} as status,
            ${dateExpr(startedAt)} as "startedAt",
            ${dateExpr(endedAt)} as "endedAt",
            case when ${columnExpr(startedAt)} is not null and ${columnExpr(endedAt)} is not null
                 then extract(epoch from (${columnExpr(endedAt)}::timestamptz - ${columnExpr(startedAt)}::timestamptz))
                 else null end as "durationSeconds",
            ${numberExpr(issueNumber)} as "issueNumber",
            ${numberExpr(pullRequestNumber)} as "pullRequestNumber"
       from ${quoteIdentifier(table.name)}
      where ${quoteIdentifier(id)}::text = $1
      limit 1`,
    [runIdValue]
  );

  const row = rows.rows[0];
  if (!row) return null;

  return {
    id: row.id ?? runIdValue,
    repository: row.repository ?? "unknown",
    branch: row.branch ?? "unknown",
    status: row.status ?? "unknown",
    startedAt: coerceDate(row.startedAt),
    endedAt: coerceDate(row.endedAt),
    durationSeconds: coerceNumber(row.durationSeconds),
    issueNumber: coerceNumber(row.issueNumber),
    pullRequestNumber: coerceNumber(row.pullRequestNumber)
  };
}

async function listRunPhases(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  runIdValue: string
): Promise<RunPhase[]> {
  const table = findTable(discovered, AGENT_TABLES) ?? findTable(discovered, EVENT_TABLES);
  if (!table) return [];

  const runId = pickColumn(table, ["run_id", "dispatch_id", "id"]);
  if (!runId) return [];

  const name = pickColumn(table, ["phase", "step", "lane", "event_type", "type", "event"]);
  const status = pickColumn(table, ["outcome", "status", "state"]);
  const startedAt = pickColumn(table, ["started_at", "created_at", "ts", "timestamp", "happened_at"]);
  const endedAt = pickColumn(table, ["ended_at", "finished_at", "updated_at"]);
  const elapsedSeconds = pickColumn(table, ["elapsed_seconds", "duration_seconds", "elapsed"]);
  const summary = pickColumn(table, ["summary", "message", "details", "description"]);

  const rows = await client.query<{
    name: string | null;
    status: string | null;
    startedAt: Date | string | null;
    endedAt: Date | string | null;
    durationSeconds: string | number | null;
    summary: string | null;
  }>(
    `select ${textExpr(name, "unknown phase")} as name,
            ${textExpr(status, "unknown")} as status,
            ${dateExpr(startedAt)} as "startedAt",
            ${dateExpr(endedAt)} as "endedAt",
            coalesce(${numberExpr(elapsedSeconds)},
              case when ${columnExpr(startedAt)} is not null and ${columnExpr(endedAt)} is not null
                   then extract(epoch from (${columnExpr(endedAt)}::timestamptz - ${columnExpr(startedAt)}::timestamptz))
                   else null end) as "durationSeconds",
            ${textExpr(summary, "No summary recorded")} as summary
       from ${quoteIdentifier(table.name)}
      where ${quoteIdentifier(runId)}::text = $1
      order by ${orderExpr(startedAt)} asc
      limit 50`,
    [runIdValue]
  );

  return rows.rows.map((row) => ({
    name: row.name ?? "unknown phase",
    status: row.status ?? "unknown",
    startedAt: coerceDate(row.startedAt),
    endedAt: coerceDate(row.endedAt),
    durationSeconds: coerceNumber(row.durationSeconds),
    summary: row.summary ?? "No summary recorded"
  }));
}

async function listValidationEvidence(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  runIdValue: string
): Promise<ValidationEvidence[]> {
  const table = findTable(discovered, EVENT_TABLES) ?? findTable(discovered, AGENT_TABLES);
  if (!table) return [];

  const runId = pickColumn(table, ["run_id", "dispatch_id", "id"]);
  if (!runId) return [];

  const name = pickColumn(table, ["check_name", "validation", "phase", "step", "event_type", "type", "event"]);
  const status = pickColumn(table, ["check_status", "outcome", "status", "state"]);
  const evidence = pickColumn(table, ["evidence", "summary", "message", "details", "description"]);
  const checkedAt = pickColumn(table, ["checked_at", "finished_at", "updated_at", "created_at", "ts", "timestamp", "happened_at"]);
  const kind = pickColumn(table, ["event_type", "type", "event", "phase", "step"]);
  const validationFilter = kind ? ` and lower(${quoteIdentifier(kind)}::text) similar to '%(valid|test|lint|typecheck|build|check)%'` : "";

  const rows = await client.query<{
    name: string | null;
    status: string | null;
    evidence: string | null;
    checkedAt: Date | string | null;
  }>(
    `select ${textExpr(name, "validation")} as name,
            ${textExpr(status, "unknown")} as status,
            ${textExpr(evidence, "No evidence recorded")} as evidence,
            ${dateExpr(checkedAt)} as "checkedAt"
       from ${quoteIdentifier(table.name)}
      where ${quoteIdentifier(runId)}::text = $1${validationFilter}
      order by ${orderExpr(checkedAt)} desc
      limit 25`,
    [runIdValue]
  );

  return rows.rows.map((row) => ({
    name: row.name ?? "validation",
    status: row.status ?? "unknown",
    evidence: row.evidence ?? "No evidence recorded",
    checkedAt: coerceDate(row.checkedAt)
  }));
}

async function listRunRelatedErrors(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  runIdValue: string
): Promise<RunRelatedError[]> {
  const table = findTable(discovered, ERROR_TABLES) ?? findTable(discovered, EVENT_TABLES);
  if (!table) return [];

  const runId = pickColumn(table, ["run_id", "dispatch_id", "id"]);
  if (!runId) return [];

  const message = pickColumn(table, ["message", "error_message", "failure", "details", "summary"]);
  const happenedAt = pickColumn(table, ["created_at", "ts", "timestamp", "happened_at", "updated_at"]);

  const rows = await client.query<RunRelatedError>(
    `select ${textExpr(message, "unknown failure")} as message,
            count(*)::int as count,
            max(${dateExpr(happenedAt)}) as "latestOccurrence"
       from ${quoteIdentifier(table.name)}
      where ${quoteIdentifier(runId)}::text = $1
        and lower(${textExpr(message, "")}) <> ''
      group by 1
      order by count desc, "latestOccurrence" desc
      limit 25`,
    [runIdValue]
  );

  return rows.rows.map((row) => ({ ...row, latestOccurrence: coerceDate(row.latestOccurrence) }));
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

function nullableTextExpr(column: string | null): string {
  return column ? `${quoteIdentifier(column)}::text` : "null::text";
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

function recencyOrderExpr(primary: string | null, fallback: string | null): string {
  const expressions = [primary, fallback]
    .filter((column): column is string => Boolean(column))
    .map((column) => `${quoteIdentifier(column)}::timestamptz`);

  const recency = expressions.length > 0 ? `coalesce(${expressions.join(", ")})` : "now()";
  return `${recency} desc nulls last`;
}

function coerceDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function coerceNumber(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === "number" ? value : Number(value);
}

function emptyToNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseIssueNumber(value: string | number | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^#?(\d+)$/) ?? trimmed.match(/\/issues\/(\d+)(?:\b|$)/);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
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
