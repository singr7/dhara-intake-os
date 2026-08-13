import type { FastifyServerOptions } from 'fastify';
import type { ServerEnv } from '@dhara/contracts';

/**
 * pino logger options. Redaction is not optional: intake logs sit next to patient data,
 * so anything that could carry PII or a credential is stripped before it reaches a log
 * sink (doc 09, doc 10 §4). Extend `redactPaths` whenever a new sensitive field appears.
 */
export const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-intake-token"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.patientRef',
  'req.body.value',
  'req.body.transcript',
  '*.password',
  '*.sessionSecret',
  '*.accessKey',
];

export function loggerOptions(env: ServerEnv): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: redactPaths, censor: '[redacted]' },
    // Request id travels with every log line and into worker jobs (doc 10 §4).
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          requestId: request.id,
        };
      },
    },
  };
}
