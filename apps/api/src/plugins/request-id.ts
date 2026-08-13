import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Echoes the request id on every response. Clients quote it in bug reports, the console
 * shows it on error toasts, and worker jobs inherit it so one id traces a whole intake
 * step across api → queue → export (doc 10 §4).
 */
async function plugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const inbound = request.headers[REQUEST_ID_HEADER];
    if (typeof inbound === 'string' && inbound.length > 0 && inbound.length <= 200) {
      request.id = inbound;
    }
    void reply.header(REQUEST_ID_HEADER, request.id);
  });
}

export const requestIdPlugin = fp(plugin, { name: 'request-id' });
