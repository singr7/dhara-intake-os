// Entrypoint. Environment is validated on the very first line of work: an incomplete
// .env crashes the process here, never halfway through a patient's intake (doc 04 §3).
import { loadServerEnv } from '@dhara/contracts';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const env = loadServerEnv();
  const app = await buildServer(env);

  const close = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void close('SIGTERM'));
  process.on('SIGINT', () => void close('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: env.API_PORT });
}

main().catch((error) => {
  // No logger yet at this point — write the failure plainly and exit non-zero so the
  // container restarts loudly instead of serving a half-configured API.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
