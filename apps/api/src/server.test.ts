import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  healthSchema,
  parseServerEnv,
  PROBLEM_CONTENT_TYPE,
  problemSchema,
} from '@dhara/contracts';
import { API_PREFIX, buildServer } from './server.js';

const env = parseServerEnv({
  NODE_ENV: 'test',
  APP_BASE_URL: 'http://localhost:8080',
  DATABASE_URL: 'postgresql://dhara:pw@localhost:5432/dhara',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  SESSION_SECRET: 'a'.repeat(32),
  LOG_LEVEL: 'error',
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer(env);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/v1/health', () => {
  it('returns 200 with the doc 07 health contract', async () => {
    const response = await app.inject({ method: 'GET', url: `${API_PREFIX}/health` });

    expect(response.statusCode).toBe(200);
    const body = healthSchema.parse(response.json());
    expect(body).toMatchObject({ status: 'ok', db: false, redis: false, s3: false });
  });

  it('echoes a request id on the response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/health`,
      headers: { 'x-request-id': 'req-under-test' },
    });

    expect(response.headers['x-request-id']).toBe('req-under-test');
  });
});

describe('error handling', () => {
  it('answers unknown routes with RFC 7807 problem+json', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    const problem = problemSchema.parse(response.json());
    expect(problem.code).toBe('NOT_FOUND');
    expect(problem.requestId).toBeTruthy();
  });
});
