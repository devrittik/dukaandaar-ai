type LogData = Record<string, unknown> | string | number | boolean | null | undefined;

function formatData(data?: LogData): string {
  if (data === undefined) return "";
  if (typeof data === "string") return ` ${data}`;
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return " [unserializable data]";
  }
}

export function log(scope: string, message: string, data?: LogData): void {
  console.log(`[${scope}] ${message}${formatData(data)}`);
}

export function logWarn(scope: string, message: string, data?: LogData): void {
  console.warn(`[${scope}] ${message}${formatData(data)}`);
}

export function logError(scope: string, message: string, error?: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : error;
  console.error(`[${scope}] ${message}${formatData(detail as LogData)}`);
}
