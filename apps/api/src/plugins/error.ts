import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  PROBLEM_CONTENT_TYPE,
  problemStatusByCode,
  type Problem,
  type ProblemCode,
} from '@dhara/contracts';

const PROBLEM_TYPE_BASE = 'https://docs.dhara.health/problems/';

/**
 * A domain error carrying a stable `code` from doc 07 §7. Modules throw these; this plugin
 * is the only place that decides how an error becomes an HTTP response.
 */
export class ApiError extends Error {
  readonly code: ProblemCode;
  readonly status: number;
  readonly detail?: string;
  /** RFC 7807 extension member, for errors that are genuinely a list (see `problem.ts`). */
  readonly issues?: Problem['issues'];

  constructor(
    code: ProblemCode,
    detail?: string,
    options: { status?: number; issues?: Problem['issues'] } = {},
  ) {
    super(detail ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? problemStatusByCode[code];
    this.detail = detail;
    this.issues = options.issues;
  }
}

const titles: Partial<Record<ProblemCode, string>> = {
  DSL_VALIDATION_FAILED: 'Workflow document is not valid',
  NOT_IMPLEMENTED: 'Not implemented yet',
  AUTH_REQUIRED: 'Authentication required',
  FORBIDDEN: 'Forbidden',
  VALIDATION_FAILED: 'Request validation failed',
  NOT_FOUND: 'Resource not found',
  RATE_LIMITED: 'Too many requests',
  INTERNAL_ERROR: 'Internal server error',
};

export function buildProblem(
  code: ProblemCode,
  requestId: string,
  detail?: string,
  issues?: Problem['issues'],
): Problem {
  return {
    type: `${PROBLEM_TYPE_BASE}${code.toLowerCase()}`,
    title: titles[code] ?? code.replaceAll('_', ' ').toLowerCase(),
    status: problemStatusByCode[code],
    code,
    ...(detail ? { detail } : {}),
    ...(issues ? { issues } : {}),
    requestId,
  };
}

function send(reply: FastifyReply, problem: Problem, status: number): FastifyReply {
  return reply.code(status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

/**
 * RFC 7807 error handling for every route (doc 07 §7). Unexpected errors are logged in
 * full but answered with a generic 500 body — stack traces and driver messages never
 * cross the wire.
 */
async function plugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ApiError) {
      request.log.info({ code: error.code }, 'request rejected');
      return send(
        reply,
        buildProblem(error.code, request.id, error.detail, error.issues),
        error.status,
      );
    }

    // Fastify/Zod validation failures.
    if (error.validation || error.statusCode === 400) {
      return send(
        reply,
        buildProblem('VALIDATION_FAILED', request.id, error.message),
        problemStatusByCode.VALIDATION_FAILED,
      );
    }

    if (error.statusCode === 429) {
      return send(
        reply,
        buildProblem('RATE_LIMITED', request.id),
        problemStatusByCode.RATE_LIMITED,
      );
    }

    request.log.error({ err: error }, 'unhandled error');
    return send(
      reply,
      buildProblem('INTERNAL_ERROR', request.id),
      problemStatusByCode.INTERNAL_ERROR,
    );
  });

  app.setNotFoundHandler((request, reply) =>
    send(
      reply,
      buildProblem('NOT_FOUND', request.id, `${request.method} ${request.url}`),
      problemStatusByCode.NOT_FOUND,
    ),
  );
}

export const errorHandlerPlugin = fp(plugin, { name: 'error-handler' });
