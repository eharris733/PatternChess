import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LandingTopBar } from '../landing/LandingTopBar';
import { LandingFooter } from '../landing/LandingFooter';

interface LegalPageProps {
  title: string;
  effectiveDate: string;
  children: ReactNode;
}

export function LegalPage({ title, effectiveDate, children }: LegalPageProps) {
  return (
    <div className="min-h-screen bg-[#F4F4F0] text-[#1A1A1A] font-sans flex flex-col">
      <LandingTopBar />
      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <Link
            to="/"
            className="font-mono uppercase text-xs tracking-tight text-[#1A1A1A]/60 hover:text-gold-dark transition-colors"
          >
            ← Back home
          </Link>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 font-mono uppercase text-xs tracking-tight text-[#1A1A1A]/50">
            Effective {effectiveDate}
          </p>
          <div className="legal-body mt-8 space-y-6 leading-relaxed text-[#1A1A1A]/90">
            {children}
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold tracking-tight">{heading}</h2>
      {children}
    </section>
  );
}
