import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  getCurrentUser,
  login as apiLogin,
  logoutApi,
  recoverAccount as apiRecoverAccount,
  type AuthedUser,
} from "../api/client";

const STORAGE_KEY = "udc.user";

interface AuthContextValue {
  user: AuthedUser | null;
  loading: boolean;
  login: (name: string) => Promise<AuthedUser>;
  recoverAccount: (code: string) => Promise<AuthedUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The cached blob is only used so the UI doesn't flash a login screen while the real check
    // below is in flight — the session cookie (via GET /auth/me), not localStorage, is what
    // actually decides whether the user is logged in from here on.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      // ignore corrupted/blocked storage
    }

    getCurrentUser()
      .then((authed) => {
        setUser(authed);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(authed));
        } catch {
          // per-viewer convenience only
        }
      })
      .catch(() => {
        // No valid session — the cookie is missing/expired, or this browser never had one for
        // this identity. Whatever the cache said, it isn't true anymore.
        setUser(null);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(name: string) {
    const authed = await apiLogin(name);
    setUser(authed);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authed));
    } catch {
      // per-viewer convenience only; app still works without persistence
    }
    return authed;
  }

  async function recoverAccount(code: string) {
    const authed = await apiRecoverAccount(code);
    setUser(authed);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authed));
    } catch {
      // per-viewer convenience only; app still works without persistence
    }
    return authed;
  }

  function logout() {
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    void logoutApi().catch(() => {
      // Best-effort — the session will simply expire on its own (30 days) if this fails.
    });
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, recoverAccount, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
