const SECRET_KEY_PATTERN = /api.?key|cookie|authorization|password|token|session/i;

export function redactDiagnosticsData<T>(value: T): T {
  return redactDiagnosticValue(value) as T;
}

export function redactDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticValue(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, entryValue]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactDiagnosticValue(entryValue)
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}
