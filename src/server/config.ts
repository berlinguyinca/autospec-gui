import "server-only";

const DEFAULT_TELEMETRY_SCHEMA = "public";
const REQUIRED_READ_ONLY_VALUE = "1";
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type AutospecServerConfig = {
  telemetryDatabaseUrl: string;
  telemetrySchema: string;
  readOnly: true;
};

export class AutospecConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutospecConfigError";
  }
}

type ServerEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function parseAutospecServerConfig(env: ServerEnv): AutospecServerConfig {
  const telemetryDatabaseUrl = requireEnv(env, "AUTOSPEC_TELEMETRY_DATABASE_URL");
  validatePostgresUrl(telemetryDatabaseUrl);

  const telemetrySchema = env.AUTOSPEC_TELEMETRY_SCHEMA?.trim() || DEFAULT_TELEMETRY_SCHEMA;
  if (!SQL_IDENTIFIER_PATTERN.test(telemetrySchema)) {
    throw new AutospecConfigError("AUTOSPEC_TELEMETRY_SCHEMA must be a simple SQL identifier");
  }

  const readOnlyValue = env.AUTOSPEC_GUI_READ_ONLY ?? REQUIRED_READ_ONLY_VALUE;
  if (readOnlyValue !== REQUIRED_READ_ONLY_VALUE) {
    throw new AutospecConfigError("AUTOSPEC_GUI_READ_ONLY must be 1; write-capable GUI mode is not supported");
  }

  return {
    telemetryDatabaseUrl,
    telemetrySchema,
    readOnly: true
  };
}

export function getAutospecServerConfig(): AutospecServerConfig {
  return parseAutospecServerConfig(process.env);
}

function requireEnv(env: ServerEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new AutospecConfigError(`${name} is required`);
  }

  return value;
}

function validatePostgresUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AutospecConfigError("AUTOSPEC_TELEMETRY_DATABASE_URL must be a valid URL");
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new AutospecConfigError("AUTOSPEC_TELEMETRY_DATABASE_URL must use postgres or postgresql protocol");
  }
}
