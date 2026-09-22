import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { SettingsProvider } from "./context/SettingsContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { AddExpenseFlow } from "./pages/AddExpenseFlow";
import { People } from "./pages/People";
import { PersonDetail } from "./pages/PersonDetail";
import { Expenses } from "./pages/Expenses";
import { Settings } from "./pages/Settings";

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return null;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/add-expense" element={<AddExpenseFlow />} />
        <Route path="/people" element={<People />} />
        <Route path="/people/:id" element={<PersonDetail />} />
        <Route path="/expenses" element={<Expenses />} />
        {/* Same page, not a separate expense/debt page — this just deep-links to auto-expand and
            scroll to one specific expense's card (e.g. from a person's debt history). */}
        <Route path="/expenses/:id" element={<Expenses />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </SettingsProvider>
  );
}
