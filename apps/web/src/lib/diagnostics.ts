const SECRET_KEY_PATTERN = /api.?key|cookie|authorization|password|token|session/i;

export function redactDiagnosticsData<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, entryValue]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(entryValue)
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}
