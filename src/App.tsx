import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './auth/RequireAuth';
import { DashboardRoute } from './routes/DashboardRoute';
import { TrainingRoute } from './routes/TrainingRoute';
import { VaultRoute } from './routes/VaultRoute';
import { LandingRoute } from './routes/LandingRoute';
import { LoginRoute } from './routes/LoginRoute';
import { ProfileRoute } from './routes/ProfileRoute';
import { SandboxRoute } from './routes/SandboxRoute';
import { EngineTestRoute } from './routes/EngineTestRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/login" element={<LoginRoute />} />
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
        <Route path="/__sandbox" element={<SandboxRoute />} />
        <Route path="/__engine-test" element={<EngineTestRoute />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
