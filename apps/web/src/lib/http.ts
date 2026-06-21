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

export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
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
