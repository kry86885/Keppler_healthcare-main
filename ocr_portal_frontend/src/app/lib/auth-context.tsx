import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { authApi, getToken, setToken, onUnauthorized, AuthUser, ApiError } from "./api";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_KEY = "keppler_user";

// Embedded inside the Hosp AI shell (see frontend/src/pages/OcrPage.tsx) as a
// single always-on tool, not a multi-user portal in its own right — so
// instead of showing a login screen, silently authenticate as this fixed
// service account on first load. Credentials for this account: see the
// registration step in ocr_portal's setup notes.
const AUTO_LOGIN_USERNAME = "hospai_ocr";
const AUTO_LOGIN_PASSWORD = "HospAI-OCR-2026-Embed!";

function loadStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => (getToken() ? loadStoredUser() : null));
  const [isAuthenticating, setIsAuthenticating] = useState(() => !getToken());

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    setToken(res.access_token);
    const authUser = { user_id: res.user_id, username: res.username };
    localStorage.setItem(USER_KEY, JSON.stringify(authUser));
    setUser(authUser);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    await authApi.register(username, password);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  // A 401 from any API call means the stored token is dead (expired or
  // invalidated) — without this, isAuthenticated stays true forever (it only
  // checks that a token string exists) and the UI is stuck rendering as
  // logged-in while every request fails, with no way back to the login screen.
  useEffect(() => {
    onUnauthorized(logout);
  }, [logout]);

  // No interactive login for the embedded OCR tool — auto-authenticate as
  // the fixed service account on first load (and again after any logout,
  // e.g. a 401 from an expired token) instead of showing the login screen.
  // isAuthenticating stays true until this resolves, so callers can render a
  // neutral loading state instead of ever flashing the login form.
  useEffect(() => {
    if (user) return;
    setIsAuthenticating(true);
    login(AUTO_LOGIN_USERNAME, AUTO_LOGIN_PASSWORD)
      .catch((err) => {
        console.error("OCR auto-login failed:", err);
      })
      .finally(() => setIsAuthenticating(false));
  }, [user, login]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isAuthenticating, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export { ApiError };
