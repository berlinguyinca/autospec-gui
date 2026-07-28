import { AutospecConfigError } from "../../src/server/config";
import {
  formatDiscoveryAuditCount,
  formatDiscoveryAuditField,
  listConfiguredDiscoveryAuditCycles,
  type DiscoveryAuditCycle
} from "../../src/server/telemetry";

export const dynamic = "force-dynamic";

type DiscoveryAuditState =
  | { kind: "ready"; cycles: DiscoveryAuditCycle[] }
  | { kind: "config-missing"; message: string };

async function getDiscoveryAuditState(): Promise<DiscoveryAuditState> {
  try {
    const cycles = await listConfiguredDiscoveryAuditCycles(24);
    return { kind: "ready", cycles };
  } catch (error) {
    if (error instanceof AutospecConfigError) {
      return { kind: "config-missing", message: error.message };
    }
    throw error;
  }
}

export default async function DiscoveryAuditPage() {
  const state = await getDiscoveryAuditState();

  return (
    <main className="shell section-shell" id="main-content">
      <section className="hero" aria-labelledby="discovery-audit-title">
        <p className="eyebrow">read-only autospec telemetry</p>
        <h1 id="discovery-audit-title">Discovery Audit telemetry</h1>
        <p>Explain why autonomous discovery did or did not file follow-up work from optional telemetry fields.</p>
      </section>

      <section className="panel" aria-labelledby="discovery-audit-table-title">
        <p className="panel-kicker">Autonomous discovery</p>
        <h2 id="discovery-audit-table-title">Recent discovery cycles</h2>
        <DiscoveryAuditContent state={state} />
      </section>
    </main>
  );
}

function DiscoveryAuditContent({ state }: { state: DiscoveryAuditState }) {
  if (state.kind === "config-missing") {
    return (
      <div className="empty-state-block">
        <h3>Telemetry configuration needed</h3>
        <p>Configure server-side telemetry to show discovery audit rows in this read-only view.</p>
        <p className="status-note">{state.message}</p>
      </div>
    );
  }

  if (state.cycles.length === 0) {
    return (
      <div className="empty-state-block">
        <h3>No discovery audit telemetry found</h3>
        <p>No discovery cycles were found in the last 24 hours. The optional discovery schema may not expose discovery data yet.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Cycle</th>
            <th scope="col">Source type</th>
            <th scope="col">Candidates</th>
            <th scope="col">Filed</th>
            <th scope="col">Dry reason</th>
            <th scope="col">Safety result</th>
            <th scope="col">Created issues</th>
          </tr>
        </thead>
        <tbody>
          {state.cycles.map((cycle) => (
            <tr key={cycle.id}>
              <td>
                <strong>{cycle.id}</strong>
                <span className="cell-note">{formatObservedAt(cycle.observedAt)}</span>
                {cycle.filedCount === 0 ? <span className="cell-note">Dry cycle</span> : null}
              </td>
              <td>{formatDiscoveryAuditField(cycle.sourceType)}</td>
              <td>{formatDiscoveryAuditCount(cycle.candidateCount)}</td>
              <td>{formatDiscoveryAuditCount(cycle.filedCount)}</td>
              <td>{formatDiscoveryAuditField(cycle.dryReason)}</td>
              <td>{formatDiscoveryAuditField(cycle.safetyResult)}</td>
              <td><IssueLinks issueNumbers={cycle.createdIssueNumbers} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssueLinks({ issueNumbers }: { issueNumbers: number[] }) {
  if (issueNumbers.length === 0) return <>No issues filed</>;

  return (
    <ul className="inline-link-list" aria-label="Created issues">
      {issueNumbers.map((issueNumber) => (
        <li key={issueNumber}>
          <a href={`/issues?issue=${issueNumber}`}>#{issueNumber}</a>
        </li>
      ))}
    </ul>
  );
}

function formatObservedAt(value: Date | null): string {
  if (!value) return "Observed Unavailable";
  return `${value.toLocaleString("en-US", { timeZone: "UTC" })} UTC`;
}
