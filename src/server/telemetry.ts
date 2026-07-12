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

export type PullRequestDrilldownFilters = {
  repository: string;
  status: string;
  windowHours: number;
  failureClass: string;
};

export type PullRequestDrilldown = {
  id: string;
  repository: string;
  number: number | null;
  title: string | null;
  status: string;
  checkStatus: string | null;
  validationSummary: string | null;
  linkedIssueNumber: number | null;
  branch: string | null;
  mergeState: string | null;
  failureClass: string | null;
  updatedAt: Date | null;
  url: string | null;
  checkUrl: string | null;
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

export type DiscoveryAuditCycle = {
  id: string;
  sourceType: string | null;
  candidateCount: number | null;
  filedCount: number | null;
  dryReason: string | null;
  safetyResult: string | null;
  createdIssueNumbers: number[];
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

type DiscoveryAuditCycleRow = {
  id: string | null;
  sourceType: string | null;
  candidateCount: string | number | null;
  filedCount: string | number | null;
  dryReason: string | null;
  safetyResult: string | null;
  createdIssues: string | number | Array<string | number> | null;
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
const DISCOVERY_AUDIT_TABLES = ["discovery_cycles", "discovery_audit", "discovery_candidates", "autonomous_discovery_cycles"];
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

export async function getPullRequestDrilldowns(
  filters: PullRequestDrilldownFilters = { repository: "all", status: "all", windowHours: 24, failureClass: "all" },
  limit = 50
): Promise<PullRequestDrilldown[]> {
  const config = getAutospecServerConfig();
  return withReadOnlyTelemetryClient(async (client) => {
    const discovered = await discoverTelemetrySchema(client, config.telemetrySchema);
    return listPullRequestDrilldowns(client, discovered, filters, limit);
  }, config);
}

export async function listPullRequestDrilldowns(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  filters: PullRequestDrilldownFilters = { repository: "all", status: "all", windowHours: 24, failureClass: "all" },
  limit = 50
): Promise<PullRequestDrilldown[]> {
  const table = findTable(discovered, PR_TABLES);
  if (!table) return [];

  const id = pickColumn(table, ["id", "pull_request_id", "pr_id", "node_id"]);
  const repository = pickColumn(table, ["repository", "repo", "repo_name", "name_with_owner"]);
  const number = pickColumn(table, ["number", "pr_number", "pull_request_number", "github_pr_number", "pr"]);
  const title = pickColumn(table, ["title", "pull_request_title", "summary"]);
  const status = pickColumn(table, ["status", "state"]);
  const checkStatus = pickColumn(table, ["check_status", "ci_status", "checks_status", "conclusion"]);
  const validationSummary = pickColumn(table, ["validation_summary", "validation", "check_summary", "summary", "message", "details"]);
  const linkedIssueNumber = pickColumn(table, ["linked_issue_number", "issue_number", "issue", "github_issue_number"]);
  const branch = pickColumn(table, ["branch", "head_branch", "source_branch", "ref"]);
  const mergeState = pickColumn(table, ["merge_state", "mergeable_state", "merge_status"]);
  const failureClass = pickColumn(table, ["failure_class", "failure_type", "error_class", "classification"]);
  const updatedAt = pickColumn(table, ["updated_at", "checked_at", "created_at", "ts", "timestamp", "merged_at"]);
  const url = pickColumn(table, ["url", "html_url", "pull_request_url", "pr_url"]);
  const checkUrl = pickColumn(table, ["check_url", "check_run_url", "ci_url", "validation_url"]);

  const params: Array<string | number> = [buildWindow(filters.windowHours).from.toISOString()];
  const predicates = [windowPredicate(updatedAt)];

  if (filters.repository !== "all" && repository) {
    params.push(filters.repository);
    predicates.push(`lower(${quoteIdentifier(repository)}::text) = lower($${params.length}::text)`);
  }

  if (filters.status !== "all") {
    params.push(filters.status);
    predicates.push(`lower(coalesce(${columnExpr(checkStatus)}::text, ${columnExpr(status)}::text, ${columnExpr(mergeState)}::text, '')) = lower($${params.length}::text)`);
  }

  if (filters.failureClass !== "all" && failureClass) {
    params.push(filters.failureClass);
    predicates.push(`lower(${quoteIdentifier(failureClass)}::text) = lower($${params.length}::text)`);
  }

  params.push(limit);

  const rows = await client.query<{
    id: string | null;
    repository: string | null;
    number: string | number | null;
    title: string | null;
    status: string | null;
    checkStatus: string | null;
    validationSummary: string | null;
    linkedIssueNumber: string | number | null;
    branch: string | null;
    mergeState: string | null;
    failureClass: string | null;
    updatedAt: Date | string | null;
    url: string | null;
    checkUrl: string | null;
  }>(
    `select ${textExpr(id, "unknown")} as id,
            ${textExpr(repository, "unknown")} as repository,
            ${numberExpr(number)} as number,
            ${nullableTextExpr(title)} as title,
            ${textExpr(status, "unknown")} as status,
            ${nullableTextExpr(checkStatus)} as "checkStatus",
            ${nullableTextExpr(validationSummary)} as "validationSummary",
            ${numberExpr(linkedIssueNumber)} as "linkedIssueNumber",
            ${nullableTextExpr(branch)} as branch,
            ${nullableTextExpr(mergeState)} as "mergeState",
            ${nullableTextExpr(failureClass)} as "failureClass",
            ${dateExpr(updatedAt)} as "updatedAt",
            ${nullableTextExpr(url)} as url,
            ${nullableTextExpr(checkUrl)} as "checkUrl"
       from ${quoteIdentifier(table.name)}
      where ${predicates.join(" and ")}
      order by ${orderExpr(updatedAt)} desc
      limit $${params.length}`,
    params
  );

  return rows.rows.map((row) => ({
    id: row.id ?? "unknown",
    repository: row.repository ?? "unknown",
    number: coerceNumber(row.number),
    title: emptyToNull(row.title),
    status: row.status ?? "unknown",
    checkStatus: emptyToNull(row.checkStatus),
    validationSummary: emptyToNull(row.validationSummary),
    linkedIssueNumber: coerceNumber(row.linkedIssueNumber),
    branch: emptyToNull(row.branch),
    mergeState: emptyToNull(row.mergeState),
    failureClass: emptyToNull(row.failureClass),
    updatedAt: coerceDate(row.updatedAt),
    url: emptyToNull(row.url),
    checkUrl: emptyToNull(row.checkUrl)
  }));
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


export async function listConfiguredDiscoveryAuditCycles(hours = 24): Promise<DiscoveryAuditCycle[]> {
  const config = getAutospecServerConfig();
  return withReadOnlyTelemetryClient(async (client) => {
    const discovered = await discoverTelemetrySchema(client, config.telemetrySchema);
    return listDiscoveryAuditCycles(client, discovered, buildWindow(hours));
  }, config);
}

export async function listDiscoveryAuditCycles(
  client: ReadOnlyTelemetryClient,
  discovered: DiscoveredTelemetrySchema,
  window: TelemetryTimeWindow = buildWindow(24),
  limit = 25
): Promise<DiscoveryAuditCycle[]> {
  const table = findTable(discovered, DISCOVERY_AUDIT_TABLES);
  if (!table) return [];

  const id = pickColumn(table, ["id", "cycle_id", "run_id", "dispatch_id"]);
  const sourceType = pickColumn(table, ["source_type", "source", "kind", "discovery_source"]);
  const candidateCount = pickColumn(table, ["candidate_count", "candidates", "candidate_total", "discovered_count"]);
  const filedCount = pickColumn(table, ["filed_count", "created_count", "issues_filed", "created_issue_count"]);
  const dryReason = pickColumn(table, ["dry_reason", "dry_run_reason", "skip_reason", "no_file_reason", "reason"]);
  const safetyResult = pickColumn(table, ["safety_result", "safety_status", "guardrail_result", "safety"]);
  const createdIssues = pickColumn(table, ["created_issue_numbers", "created_issues", "issue_numbers", "issues", "github_issue_numbers"]);
  const observedAt = pickColumn(table, ["observed_at", "created_at", "updated_at", "ts", "timestamp", "happened_at"]);

  const rows = await client.query<DiscoveryAuditCycleRow>(
    `select ${textExpr(id, "unknown")} as id,
            ${nullableTextExpr(sourceType)} as "sourceType",
            ${nullableTextExpr(candidateCount)} as "candidateCount",
            ${nullableTextExpr(filedCount)} as "filedCount",
            ${nullableTextExpr(dryReason)} as "dryReason",
            ${nullableTextExpr(safetyResult)} as "safetyResult",
            ${nullableTextExpr(createdIssues)} as "createdIssues",
            ${dateExpr(observedAt)} as "observedAt"
       from ${quoteIdentifier(table.name)}
      where ${windowPredicate(observedAt)}
      order by ${orderExpr(observedAt)} desc
      limit $2`,
    [window.from.toISOString(), limit]
  );

  return rows.rows.map(shapeDiscoveryAuditCycle);
}

function shapeDiscoveryAuditCycle(row: DiscoveryAuditCycleRow): DiscoveryAuditCycle {
  return {
    id: row.id ?? "unknown",
    sourceType: emptyToNull(row.sourceType),
    candidateCount: coerceOptionalCount(row.candidateCount),
    filedCount: coerceOptionalCount(row.filedCount),
    dryReason: emptyToNull(row.dryReason),
    safetyResult: emptyToNull(row.safetyResult),
    createdIssueNumbers: parseDiscoveryAuditIssueNumbers(row.createdIssues),
    observedAt: coerceDate(row.observedAt)
  };
}

export function formatDiscoveryAuditCount(value: number | null): string {
  return value === null ? "Unavailable" : String(value);
}

export function formatDiscoveryAuditField(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replaceAll("_", " ") : "Unavailable";
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

export function parseDiscoveryAuditIssueNumbers(value: string | number | Array<string | number> | null): number[] {
  if (Array.isArray(value)) return uniqueIssueNumbers(value.flatMap(issueNumberFromTrustedValue));

  if (typeof value === "number") return uniqueIssueNumbers(issueNumberFromTrustedValue(value));

  const trimmed = value?.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return uniqueIssueNumbers(parsed.flatMap((item) => (typeof item === "number" || typeof item === "string") ? issueNumberFromTrustedValue(item) : []));
    }
  } catch {
    // Fall through to strict token parsing.
  }

  const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const issueNumbers: number[] = [];
  for (const token of tokens) {
    const parsed = issueNumberFromTrustedToken(token);
    if (parsed === null) return [];
    issueNumbers.push(parsed);
  }

  return uniqueIssueNumbers(issueNumbers);
}

function issueNumberFromTrustedValue(value: string | number): number[] {
  const parsed = parseIssueNumber(value);
  return parsed === null ? [] : [parsed];
}

function issueNumberFromTrustedToken(token: string): number | null {
  return parseIssueNumber(token) ?? parseIssueNumberFromIssueUrl(token);
}

function uniqueIssueNumbers(values: number[]): number[] {
  return Array.from(new Set(values));
}

function coerceOptionalCount(value: string | number | null): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;

  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseIssueNumber(value: string | number | null): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^#?(\d+)$/);
  if (match) return safeIssueNumber(match[1]);

  return parseIssueNumberFromIssueUrl(trimmed);
}

function parseIssueNumberFromIssueUrl(value: string): number | null {
  const match = value.match(/^https?:\/\/[^\s]+\/issues\/(\d+)(?:[?#].*)?$/) ?? value.match(/^\/issues\/(\d+)(?:[?#].*)?$/);
  if (!match) return null;

  return safeIssueNumber(match[1]);
}

function safeIssueNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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
