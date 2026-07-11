import "server-only";

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { getAutospecServerConfig, type AutospecServerConfig } from "./config";

const DEFAULT_POOL_SIZE = 5;
const READ_ONLY_SQL_START = /^(select|with|show|explain)\b/i;
const WRITE_OR_DDL_SQL = /\b(insert|update|delete|merge|call|copy|truncate|create|alter|drop|grant|revoke|vacuum|analyze|refresh|reindex|cluster|listen|notify|set)\b/i;

type GlobalWithTelemetryPool = typeof globalThis & {
  __autospecTelemetryPool?: Pool;
  __autospecTelemetryPoolUrl?: string;
};

export type ReadOnlyTelemetryClient = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
};

export class AutospecReadOnlyQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutospecReadOnlyQueryError";
  }
}

export function getTelemetryPool(config: AutospecServerConfig = getAutospecServerConfig()): Pool {
  const globalState = globalThis as GlobalWithTelemetryPool;
  if (globalState.__autospecTelemetryPool && globalState.__autospecTelemetryPoolUrl === config.telemetryDatabaseUrl) {
    return globalState.__autospecTelemetryPool;
  }

  const pool = new Pool({
    application_name: "autospec-gui-readonly",
    connectionString: config.telemetryDatabaseUrl,
    max: DEFAULT_POOL_SIZE
  });

  globalState.__autospecTelemetryPool = pool;
  globalState.__autospecTelemetryPoolUrl = config.telemetryDatabaseUrl;
  return pool;
}

export async function withReadOnlyTelemetryClient<T>(
  callback: (client: ReadOnlyTelemetryClient) => Promise<T>,
  config: AutospecServerConfig = getAutospecServerConfig()
): Promise<T> {
  const pool = getTelemetryPool(config);
  const client = await pool.connect();

  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL search_path TO ${quoteIdentifier(config.telemetrySchema)}, pg_catalog`);

    const guardedClient: ReadOnlyTelemetryClient = {
      query: <R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
        assertReadOnlySql(text);
        return client.query<R>(text, values ? [...values] : undefined);
      }
    };

    const result = await callback(guardedClient);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export function assertReadOnlySql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new AutospecReadOnlyQueryError("Telemetry SQL must be read-only and non-empty");
  }

  const withoutTrailingSemicolon = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
  if (withoutTrailingSemicolon.includes(";")) {
    throw new AutospecReadOnlyQueryError("Telemetry SQL must be a single read-only statement");
  }

  if (!READ_ONLY_SQL_START.test(withoutTrailingSemicolon)) {
    throw new AutospecReadOnlyQueryError("Telemetry SQL must be read-only SELECT/SHOW/EXPLAIN text");
  }

  if (WRITE_OR_DDL_SQL.test(withoutTrailingSemicolon)) {
    throw new AutospecReadOnlyQueryError("Telemetry SQL must not contain write or DDL keywords");
  }

  return sql;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original query/configuration error.
  }
}
