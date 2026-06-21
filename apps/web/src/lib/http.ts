import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

import {
  DomainConflictError,
  DomainEntityNotFoundError,
  DomainQuotaExceededError,
  DomainTransitionError
} from "@/lib/domain-store";

type SerializableIssue = {
  code: string;
  message: string;
  path: Array<string | number>;
};

export class InvalidRequestError extends Error {
  constructor(public readonly issues: SerializableIssue[]) {
    super("Invalid request");
    this.name = "InvalidRequestError";
  }
}

export class UnsafeWriteRequestError extends Error {
  constructor(
    public readonly code: "forbidden_origin" | "json_required",
    public readonly status: 403 | 415
  ) {
    super(code);
    this.name = "UnsafeWriteRequestError";
  }
}

export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  assertTrustedJsonWrite(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new InvalidRequestError([
      {
        code: "invalid_json",
        message: "Request body must be valid JSON",
        path: []
      }
    ]);
  }

  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new InvalidRequestError(serializeZodIssues(error));
    }
    throw error;
  }
}

export async function withApiErrorHandling<T>(handler: () => Promise<T>): Promise<T | Response> {
  try {
    return await handler();
  } catch (error) {
    return createErrorResponse(error);
  }
}

export function createErrorResponse(error: unknown): Response {
  if (error instanceof UnsafeWriteRequestError) {
    return NextResponse.json({ error: error.code }, { status: error.status });
  }

  if (error instanceof InvalidRequestError) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: error.issues
      },
      { status: 400 }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: serializeZodIssues(error)
      },
      { status: 400 }
    );
  }

  if (error instanceof DomainTransitionError) {
    return NextResponse.json(
      {
        error: "illegal_transition",
        from: error.from,
        to: error.to
      },
      { status: 409 }
    );
  }

  if (error instanceof DomainEntityNotFoundError) {
    return NextResponse.json(
      {
        error: "not_found",
        entityType: error.entityType,
        entityId: error.entityId
      },
      { status: 404 }
    );
  }

  if (error instanceof DomainConflictError) {
    return NextResponse.json(
      {
        error: "conflict",
        entityType: error.entityType,
        entityId: error.entityId,
        expectedUpdatedAt: error.expectedUpdatedAt,
        actualUpdatedAt: error.actualUpdatedAt
      },
      { status: 409 }
    );
  }

  if (error instanceof DomainQuotaExceededError) {
    return NextResponse.json(
      {
        error: "quota_blocked",
        date: error.date,
        used: error.used,
        limit: error.limit
      },
      { status: 409 }
    );
  }

  if (isRepositoryCorruptionError(error)) {
    return NextResponse.json(
      {
        error: "repository_corruption",
        message: "Persistent data is corrupted and could not be safely read."
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      error: "internal_error"
    },
    { status: 500 }
  );
}

export function assertTrustedJsonWrite(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && !isTrustedLocalOrigin(origin) && origin !== process.env.BOSS_AGENT_EXTENSION_ORIGIN) {
    throw new UnsafeWriteRequestError("forbidden_origin", 403);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new UnsafeWriteRequestError("json_required", 415);
  }
}

function isTrustedLocalOrigin(origin: string): boolean {
  return origin === (process.env.BOSS_AGENT_WEB_ORIGIN ?? "http://localhost:3000");
}

function serializeZodIssues(error: ZodError): SerializableIssue[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.filter((segment): segment is string | number => typeof segment === "string" || typeof segment === "number")
  }));
}

function isRepositoryCorruptionError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes("配置文件损坏");
}
