import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, api } from "@/src/lib/api";

export type User = {
  id: string;
  username: string;
  display_name: string | null;
  grade: string | null;
  province: string | null;
  subjects: string[];
  role: string;
  created_at: string;
};

export type ProfileInput = {
  display_name?: string;
  grade?: string;
  province?: string;
  subjects?: string[];
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  backendAvailable: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, profile?: ProfileInput) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (profile: ProfileInput) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ user: User }>("/api/me");
        if (!cancelled) setUser(data.user);
      } catch (error) {
        // 401 = 未登录；网络/服务错误 = 后端未连接（本地预览时属正常）。
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) {
          setBackendAvailable(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api<{ user: User }>("/api/login", { method: "POST", body: { username, password } });
    setUser(data.user);
    setBackendAvailable(true);
  }, []);

  const register = useCallback(async (username: string, password: string, profile?: ProfileInput) => {
    const data = await api<{ user: User }>("/api/register", {
      method: "POST",
      body: { username, password, ...profile },
    });
    setUser(data.user);
    setBackendAvailable(true);
  }, []);

  const logout = useCallback(async () => {
    await api("/api/logout", { method: "POST" });
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (profile: ProfileInput) => {
    const data = await api<{ user: User }>("/api/profile", { method: "POST", body: profile });
    setUser(data.user);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api("/api/password", {
      method: "POST",
      body: { current_password: currentPassword, new_password: newPassword },
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, backendAvailable, login, register, logout, updateProfile, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}