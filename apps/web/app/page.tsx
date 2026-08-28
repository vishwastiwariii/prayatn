'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type State = 'pending' | 'ok' | 'error';

interface Health {
  api: State;
  postgres: State;
  redis: State;
}

const LABELS: Record<State, string> = {
  pending: 'Checking...',
  ok: 'Online',
  error: 'Unavailable',
};

export default function Home() {
  const [health, setHealth] = useState<Health>({
    api: 'pending',
    postgres: 'pending',
    redis: 'pending',
  });

  useEffect(() => {
    let cancelled = false;

    async function check(): Promise<void> {
      try {
        const base = await fetch(`${API_URL}/health`, { cache: 'no-store' });
        const apiOk = base.ok && (await base.json())?.status === 'ok';

        let postgres: State = 'error';
        let redis: State = 'error';
        try {
          const deps = await fetch(`${API_URL}/health/dependencies`, { cache: 'no-store' });
          const body = await deps.json();
          postgres = body?.dependencies?.postgres === 'ok' ? 'ok' : 'error';
          redis = body?.dependencies?.redis === 'ok' ? 'ok' : 'error';
        } catch {
          // API reachable but the dependency check failed — leave both as error.
        }

        if (!cancelled) {
          setHealth({ api: apiOk ? 'ok' : 'error', postgres, redis });
        }
      } catch {
        if (!cancelled) {
          setHealth({ api: 'error', postgres: 'error', redis: 'error' });
        }
      }
    }

    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <main>
      <h1>Recovery Desk</h1>
      <p className="subtitle">Foundation Online</p>
      <ul>
        <Row label="API" state={health.api} />
        <Row label="PostgreSQL" state={health.postgres} />
        <Row label="Redis" state={health.redis} />
      </ul>
    </main>
  );
}

function Row({ label, state }: { label: string; state: State }) {
  return (
    <li>
      <span>{label}</span>
      <span className="status" data-state={state}>
        {LABELS[state]}
      </span>
    </li>
  );
}
