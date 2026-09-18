import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { AddExpenseFlow } from "./pages/AddExpenseFlow";
import { People } from "./pages/People";
import { PersonDetail } from "./pages/PersonDetail";
import { Expenses } from "./pages/Expenses";
import { ExpenseDetail } from "./pages/ExpenseDetail";
import { Debts } from "./pages/Debts";
import { DebtDetail } from "./pages/DebtDetail";
import { Reminders } from "./pages/Reminders";

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
        <Route path="/expenses/:id" element={<ExpenseDetail />} />
        <Route path="/debts" element={<Debts />} />
        <Route path="/debts/:id" element={<DebtDetail />} />
        <Route path="/reminders" element={<Reminders />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
