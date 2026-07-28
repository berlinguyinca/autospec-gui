import { AutospecConfigError } from "../../../src/server/config";
import { getRunDetail, type RunDetail, type RunPhase, type RunRelatedError, type ValidationEvidence } from "../../../src/server/telemetry";

export const dynamic = "force-dynamic";

type RunDetailPageProps = {
  params: Promise<{ runId: string }>;
};

type RunDetailPageState =
  | { kind: "ready"; detail: RunDetail }
  | { kind: "not-found"; runId: string }
  | { kind: "config-missing"; message: string };

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { runId } = await params;
  const state = await getRunDetailPageState(runId);

  return (
    <main className="shell section-shell" id="main-content">
      <section className="hero" aria-labelledby="run-detail-title">
        <p className="eyebrow">read-only autospec telemetry</p>
        <h1 id="run-detail-title">{state.kind === "ready" ? `Run ${state.detail.run.id}` : "Run detail"}</h1>
        <p>Inspect one autospec run summary, timeline, validation evidence, and related errors without reading raw logs.</p>
      </section>

      {state.kind === "config-missing" ? <MissingConfigState message={state.message} /> : null}
      {state.kind === "not-found" ? <NotFoundState runId={state.runId} /> : null}
      {state.kind === "ready" ? <RunDetailPanel detail={state.detail} /> : null}
    </main>
  );
}

async function getRunDetailPageState(runId: string): Promise<RunDetailPageState> {
  try {
    const detail = await getRunDetail(runId);
    return detail ? { kind: "ready", detail } : { kind: "not-found", runId };
  } catch (error) {
    if (error instanceof AutospecConfigError) {
      return { kind: "config-missing", message: error.message };
    }
    throw error;
  }
}

function MissingConfigState({ message }: { message: string }) {
  return (
    <section className="panel empty-state" aria-labelledby="run-config-title">
      <p className="panel-kicker">Configuration state</p>
      <h2 id="run-config-title">Telemetry configuration needed</h2>
      <p>
        Add the server-side telemetry database setting for this read-only dashboard to load run details. This page will not attempt
        client-side telemetry access or expose connection settings.
      </p>
      <p>{message}</p>
    </section>
  );
}

function NotFoundState({ runId }: { runId: string }) {
  return (
    <section className="panel empty-state" aria-labelledby="run-not-found-title">
      <p className="panel-kicker">Lookup result</p>
      <h2 id="run-not-found-title">Run not found</h2>
      <p>No telemetry run with id {runId} is available in the configured read-only source.</p>
      <p><a href="/runs">Back to Runs</a></p>
    </section>
  );
}

function RunDetailPanel({ detail }: { detail: RunDetail }) {
  return (
    <>
      <section className="panel" aria-labelledby="run-summary-title">
        <p className="panel-kicker">Run identity</p>
        <h2 id="run-summary-title">Summary</h2>
        <dl className="detail-list">
          <DetailItem label="Run id" value={detail.run.id} />
          <DetailItem label="Repository" value={detail.run.repository} />
          <DetailItem label="Branch" value={detail.run.branch} />
          <DetailItem label="Status" value={detail.run.status} />
          <DetailItem label="Started" value={formatDateTime(detail.run.startedAt)} />
          <DetailItem label="Ended" value={formatDateTime(detail.run.endedAt)} />
          <DetailItem label="Duration" value={formatDuration(detail.run)} />
          <DetailItem label="Linked issue" value={detail.run.issueNumber === null ? "Not available" : `Issue #${detail.run.issueNumber}`} />
          <DetailItem label="Pull request" value={detail.run.pullRequestNumber === null ? "Not available" : `PR #${detail.run.pullRequestNumber}`} />
        </dl>
      </section>

      <section className="detail-grid" aria-label="Run detail sections">
        <section className="panel" aria-labelledby="phase-timeline-title">
          <p className="panel-kicker">Timeline</p>
          <h2 id="phase-timeline-title">Phase timeline</h2>
          {detail.phases.length > 0 ? <PhaseTimeline phases={detail.phases} /> : <EmptyState>No phase timeline events are available for this run.</EmptyState>}
        </section>

        <section className="panel" aria-labelledby="validation-title">
          <p className="panel-kicker">Validation</p>
          <h2 id="validation-title">Validation evidence</h2>
          {detail.validations.length > 0 ? <ValidationList validations={detail.validations} /> : <EmptyState>No validation evidence is available for this run.</EmptyState>}
        </section>
      </section>

      <section className="panel" aria-labelledby="related-errors-title">
        <p className="panel-kicker">Failures</p>
        <h2 id="related-errors-title">Related errors</h2>
        {detail.errors.length > 0 ? <ErrorList errors={detail.errors} /> : <EmptyState>No related errors are available for this run.</EmptyState>}
      </section>
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PhaseTimeline({ phases }: { phases: RunPhase[] }) {
  return (
    <ol className="timeline-list">
      {phases.map((phase) => (
        <li key={`${phase.name}-${phase.startedAt?.toISOString() ?? phase.summary}`}>
          <strong>{phase.name}</strong>
          <span className="status-pill">{phase.status}</span>
          <p>{phase.summary}</p>
          <small>{formatDateTime(phase.startedAt)} · {formatDuration(phase)}</small>
        </li>
      ))}
    </ol>
  );
}

function ValidationList({ validations }: { validations: ValidationEvidence[] }) {
  return (
    <ul className="evidence-list">
      {validations.map((validation) => (
        <li key={`${validation.name}-${validation.checkedAt?.toISOString() ?? validation.evidence}`}>
          <strong>{validation.name}</strong>
          <span className="status-pill">{validation.status}</span>
          <p>{validation.evidence}</p>
          <small>{formatDateTime(validation.checkedAt)}</small>
        </li>
      ))}
    </ul>
  );
}

function ErrorList({ errors }: { errors: RunRelatedError[] }) {
  return (
    <ul className="error-list">
      {errors.map((error) => (
        <li key={`${error.message}-${error.latestOccurrence?.toISOString() ?? "unknown"}`}>
          <strong>{error.message}</strong>
          <span>{error.count} occurrences · latest {formatDateTime(error.latestOccurrence)}</span>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="empty-state" role="status">
      <strong>{children}</strong>
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

function formatDuration(value: { startedAt: Date | null; endedAt: Date | null; durationSeconds: number | null }): string {
  if (value.durationSeconds !== null) {
    return formatSeconds(value.durationSeconds);
  }
  if (value.startedAt && !value.endedAt) {
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
