import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './services/api';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import ClientsPage from './pages/ClientsPage';
import PropertiesPage from './pages/PropertiesPage';
import ServicesPage from './pages/ServicesPage';
import CasesPage from './pages/CasesPage';
import TasksPage from './pages/TasksPage';
import DocumentsPage from './pages/DocumentsPage';
import PortalPage from './pages/PortalPage';
import CalendarPage from './pages/CalendarPage';
import FinancePage from './pages/FinancePage';
import TeamPage from './pages/TeamPage';
import ReportsPage from './pages/ReportsPage';
import DocumentTemplatesPage from './pages/DocumentTemplatesPage';
import NotificationsPage from './pages/NotificationsPage';
import AdminPage from './pages/AdminPage';
import IntegrationsPage from './pages/IntegrationsPage';
import AutomationsPage from './pages/AutomationsPage';
import SettingsPage from './pages/SettingsPage';
import AuditPage from './pages/AuditPage';
import PortalRequestsPage from './pages/PortalRequestsPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AppLayout from './layouts/AppLayout';
import LoadingScreen from './components/LoadingScreen';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refreshSession() {
    try {
      const { data } = await api.get('/auth/me');
      setSession(data);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refreshSession(); }, []);

  if (loading) return <LoadingScreen />;

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <AuthPage onSuccess={refreshSession} />} />
      <Route path="/accept-invite" element={<AcceptInvitePage onSuccess={refreshSession} />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/portal/*" element={<PortalPage />} />
      <Route path="/*" element={session ? (
        <AppLayout session={session} onLogout={() => setSession(null)}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/properties" element={<PropertiesPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/cases" element={<CasesPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/finance" element={<FinancePage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/document-templates" element={<DocumentTemplatesPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/automations" element={<AutomationsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/portal-requests" element={<PortalRequestsPage />} />
            <Route path="/platform-admin" element={<AdminPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppLayout>
      ) : <Navigate to="/login" replace />} />
    </Routes>
  );
}
