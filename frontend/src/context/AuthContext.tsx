import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { login as apiLogin, type AuthedUser } from "../api/client";

const STORAGE_KEY = "udc.user";

interface AuthContextValue {
  user: AuthedUser | null;
  loading: boolean;
  loginWithUsername: (telegramUsername: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      // ignore corrupted/blocked storage
    }
    setLoading(false);
  }, []);

  async function loginWithUsername(telegramUsername: string) {
    const authed = await apiLogin(telegramUsername);
    setUser(authed);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authed));
    } catch {
      // per-viewer convenience only; app still works without persistence
    }
  }

  function logout() {
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginWithUsername, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
