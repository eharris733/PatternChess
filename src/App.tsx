import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './auth/RequireAuth';
// Public routes are eager: they are prerendered to static HTML, so React should
// render over that markup immediately without a Suspense fallback flash.
import { LandingRoute } from './routes/LandingRoute';
import { LoginRoute } from './routes/LoginRoute';
import { TermsRoute } from './routes/TermsRoute';
import { PrivacyRoute } from './routes/PrivacyRoute';
import { AboutRoute } from './routes/AboutRoute';
import { FaqRoute } from './routes/FaqRoute';
import { BlogIndex } from './routes/BlogIndex';
import { BlogPost } from './routes/BlogPost';
import { PuzzleRoute } from './routes/PuzzleRoute';

// Gated app routes are lazy: they sit behind auth (a brief fallback is fine) and
// carry the heavy code — recharts (analytics), training-engine glue — that we
// want out of the initial bundle the public pages load.
const DashboardRoute = lazy(() =>
  import('./routes/DashboardRoute').then((m) => ({ default: m.DashboardRoute })),
);
const TrainingRoute = lazy(() =>
  import('./routes/TrainingRoute').then((m) => ({ default: m.TrainingRoute })),
);
const VaultRoute = lazy(() => import('./routes/VaultRoute').then((m) => ({ default: m.VaultRoute })));
const ProfileRoute = lazy(() =>
  import('./routes/ProfileRoute').then((m) => ({ default: m.ProfileRoute })),
);
const AchievementsRoute = lazy(() =>
  import('./routes/AchievementsRoute').then((m) => ({ default: m.AchievementsRoute })),
);
const AnalyticsRoute = lazy(() =>
  import('./routes/AnalyticsRoute').then((m) => ({ default: m.AnalyticsRoute })),
);
const SandboxRoute = lazy(() =>
  import('./routes/SandboxRoute').then((m) => ({ default: m.SandboxRoute })),
);
const EngineTestRoute = lazy(() =>
  import('./routes/EngineTestRoute').then((m) => ({ default: m.EngineTestRoute })),
);

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="text-text-secondary text-sm">Loading…</div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/terms" element={<TermsRoute />} />
      <Route path="/privacy" element={<PrivacyRoute />} />
      <Route path="/about" element={<AboutRoute />} />
      <Route path="/faq" element={<FaqRoute />} />
      <Route path="/blog" element={<BlogIndex />} />
      <Route path="/blog/:slug" element={<BlogPost />} />
      <Route path="/p" element={<PuzzleRoute />} />
      <Route
        element={
          <AppShell>
            <Suspense fallback={<RouteFallback />}>
              <RequireAuth />
            </Suspense>
          </AppShell>
        }
      >
        <Route path="/dashboard" element={<DashboardRoute />} />
        <Route path="/training" element={<TrainingRoute />} />
        <Route path="/vault" element={<VaultRoute />} />
        <Route path="/profile" element={<ProfileRoute />} />
        <Route path="/achievements" element={<AchievementsRoute />} />
        <Route path="/analytics" element={<AnalyticsRoute />} />
        <Route path="/__sandbox" element={<SandboxRoute />} />
        <Route path="/__engine-test" element={<EngineTestRoute />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
