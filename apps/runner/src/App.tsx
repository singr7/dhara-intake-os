import { useEffect, useState } from 'react';
import { fetchHealth, type RunnerHealth } from './api.js';

/**
 * S01 shell: the DharaIntake splash plus a single API reachability probe, so a phone on
 * the LAN proves the whole nginx → api path before any intake code exists. The real flow
 * (join link → language → consent → questions) lands in S05.
 */
export function App(): JSX.Element {
  const [health, setHealth] = useState<RunnerHealth | 'loading' | 'unreachable'>('loading');

  useEffect(() => {
    let cancelled = false;
    void fetchHealth().then((result) => {
      if (!cancelled) setHealth(result ?? 'unreachable');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <img src="/icon.svg" alt="" width={96} height={96} className="drop-shadow-lg" />
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">DharaIntake</h1>
        <p className="mt-3 max-w-sm text-lg text-dhara-200">
          Guided intake. Answer a few questions before you see the doctor.
        </p>
      </div>

      <p className="min-h-tap text-sm text-white/60" role="status">
        {health === 'loading' && 'Connecting…'}
        {health === 'unreachable' && 'Waiting for the clinic system…'}
        {typeof health === 'object' && `Connected · API v${health.version}`}
      </p>
    </main>
  );
}
