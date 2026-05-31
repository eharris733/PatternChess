import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './auth/RequireAuth';
import { DashboardRoute } from './routes/DashboardRoute';
import { TrainingRoute } from './routes/TrainingRoute';
import { VaultRoute } from './routes/VaultRoute';
import { LandingRoute } from './routes/LandingRoute';
import { LoginRoute } from './routes/LoginRoute';
import { TermsRoute } from './routes/TermsRoute';
import { PrivacyRoute } from './routes/PrivacyRoute';
import { ProfileRoute } from './routes/ProfileRoute';
import { AnalyticsRoute } from './routes/AnalyticsRoute';
import { SandboxRoute } from './routes/SandboxRoute';
import { EngineTestRoute } from './routes/EngineTestRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/terms" element={<TermsRoute />} />
      <Route path="/privacy" element={<PrivacyRoute />} />
      <Route
        element={
          <AppShell>
            <RequireAuth />
          </AppShell>
        }
      >
        <Route path="/dashboard" element={<DashboardRoute />} />
        <Route path="/training" element={<TrainingRoute />} />
        <Route path="/vault" element={<VaultRoute />} />
        <Route path="/profile" element={<ProfileRoute />} />
        <Route path="/analytics" element={<AnalyticsRoute />} />
        <Route path="/__sandbox" element={<SandboxRoute />} />
        <Route path="/__engine-test" element={<EngineTestRoute />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
