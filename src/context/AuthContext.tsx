import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from "react";
import { apiRequest, GLOBAL_LOGOUT_EVENT } from "../lib/api";
import { useToast } from "@/hooks/use-toast";

interface User {
  id: number;
  email: string;
  role: "admin" | "client" | "user";
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAdmin: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  });
  const [token, setToken] = useState<string | null>(localStorage.getItem("token"));
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Sync state with localStorage in case it changes elsewhere (optional but good practice)
    const storedToken = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");
    
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const data = await apiRequest("/auth/login", "POST", { email, password });

      setUser(data.user);
      setToken(data.token);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      
      toast({
        title: "Login successful",
        description: "Welcome back!",
      });
      return true;
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  const register = async (email: string, password: string) => {
    try {
      const data = await apiRequest("/auth/register", "POST", { email, password });

      setUser(data.user);
      setToken(data.token);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      toast({
        title: "Registration successful",
        description: "Your account has been created.",
      });
      return true;
    } catch (error: any) {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  const logout = useCallback((showToast = true) => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    if (showToast) {
      toast({
        title: "Logged out",
        description: "See you soon!",
      });
    }
  }, [toast]);

  useEffect(() => {
    const handleGlobalLogout = () => logout(false);
    window.addEventListener(GLOBAL_LOGOUT_EVENT, handleGlobalLogout);
    return () => window.removeEventListener(GLOBAL_LOGOUT_EVENT, handleGlobalLogout);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, isAdmin: user?.role === "admin", isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
};
