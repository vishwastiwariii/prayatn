'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { DEFAULT_EVALUATION_SEED } from '@/lib/api/evaluation';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/evaluations', label: 'Evaluations' },
  { href: '/demo', label: 'Demo' },
  { href: '/settings', label: 'Settings' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface-1/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-2.5">
        <div className="flex items-center gap-6">
          <div>
            <Link href="/" className="text-sm font-semibold tracking-tight text-text-primary">
              Recovery Desk
            </Link>
            <p className="text-[11px] text-text-muted">Payment Recovery Command Center</p>
          </div>
          <nav className="flex items-center gap-1">
            {LINKS.map((link) => {
              const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary',
                    active && 'bg-surface-2 text-text-primary',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-[11px] text-text-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-status-good" />
          Simulation
          <span className="text-text-muted">·</span>
          <span>dataset failures-v1</span>
          <span className="text-text-muted">·</span>
          <span>seed {DEFAULT_EVALUATION_SEED}</span>
        </div>
      </div>
    </header>
  );
}
