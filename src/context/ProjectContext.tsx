import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { apiRequest, API_URL } from "../lib/api";
import { useToast } from "@/hooks/use-toast";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";

export interface Project {
  id: string;
  name: string;
  git_repository: string;
  branch: string;
  project_type: "dockerfile" | "compose";
  dockerfile_path: string;
  compose_file: string;
  port: number;
  env_vars?: { key: string; value: string }[];
  subdomain?: string;
  waf_enabled?: boolean;
  ram_limit?: number;
  container_id: string | null;
  status: "idle" | "building" | "running" | "stopped" | "failed" | "queued";
  user_id: number;
  created_at: string;
  logs: string[];
}

interface ProjectContextType {
  projects: Project[];
  isLoading: boolean;
  addProject: (p: Omit<Project, "id" | "container_id" | "status" | "created_at" | "logs" | "user_id">) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  getProject: (id: string) => Project | undefined;
  updateProject: (id: string, data: Partial<Project>) => Promise<void>;
  deployProject: (id: string) => Promise<void>;
  stopProject: (id: string) => Promise<void>;
  startProject: (id: string) => Promise<void>;
  restartProject: (id: string) => Promise<void>;
  refreshLogs: (id: string) => Promise<void>;
  subscribeToLogs: (projectId: string, callback: (log: any) => void) => () => void;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

let socket: Socket;

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { token } = useAuth();

  useEffect(() => {
    // Determine socket URL: if API_URL is relative or localhost, 
    // we might need to be careful. socket.io-client handles this well 
    // if we pass the full URL.
    socket = io(API_URL, {
      transports: ['websocket', 'polling'], // Try websocket first
      reconnectionAttempts: 5,
      path: '/socket.io', // Ensure path matches default without trailing slash
      secure: API_URL.startsWith('https'),
      rejectUnauthorized: false
    });

    socket.on("connect", () => {
      console.log("WebSocket connected successfully", socket.id);
    });

    socket.on("connect_error", (error) => {
      console.error("WebSocket connection error:", error);
    });

    socket.on("project-update", (data: { id: string; status: Project["status"]; container_id?: string }) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === data.id
            ? { ...p, status: data.status, ...(data.container_id ? { container_id: data.container_id } : {}) }
            : p
        )
      );
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const fetchProjects = useCallback(async () => {
    if (!token) {
      setProjects([]);
      setIsLoading(false);
      return;
    }

    try {
      const data = await apiRequest("/projects");
      // Initialize logs as empty array if not provided by backend
      const projectsWithLogs = data.map((p: any) => ({
        ...p,
        logs: p.logs || [],
      }));
      setProjects(projectsWithLogs);
    } catch (error) {
      console.error("Failed to fetch projects", error);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const addProject = async (p: Omit<Project, "id" | "container_id" | "status" | "created_at" | "logs" | "user_id">) => {
    try {
      const newProject = await apiRequest("/projects", "POST", p);
      setProjects((prev) => [...prev, { ...newProject, logs: [] }]);
      toast({ title: "Project created", description: "Project added successfully." });
    } catch (error: any) {
      toast({ title: "Failed to create project", description: error.message, variant: "destructive" });
    }
  };

  const deleteProject = async (id: string) => {
    try {
      await apiRequest(`/projects/${id}`, "DELETE");
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast({ title: "Project deleted", description: "Project removed successfully." });
    } catch (error: any) {
      toast({ title: "Failed to delete project", description: error.message, variant: "destructive" });
    }
  };

  const getProject = (id: string) => projects.find((p) => p.id === id);

  const updateProject = async (id: string, data: Partial<Project>) => {
    try {
      await apiRequest(`/projects/${id}`, "PUT", data);
      fetchProjects();
      toast({ title: "Project updated", description: "Project settings updated successfully. Restarting container..." });
    } catch (error: any) {
      toast({ title: "Failed to update project", description: error.message, variant: "destructive" });
      throw error;
    }
  };

  const deployProject = async (id: string) => {
    try {
      // Optimistic update
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "building" } : p))
      );
      
      await apiRequest(`/deploy/${id}`, "POST");
      
      // Fetch updated project status
      fetchProjects();
      toast({ title: "Deployment started", description: "Building your project..." });
    } catch (error: any) {
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "failed" } : p))
      );
      toast({ title: "Deployment failed", description: error.message, variant: "destructive" });
    }
  };

  const stopProject = async (id: string) => {
    try {
      await apiRequest(`/stop/${id}`, "POST");
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "stopped" } : p))
      );
      toast({ title: "Project stopped", description: "Container stopped successfully." });
    } catch (error: any) {
      toast({ title: "Failed to stop project", description: error.message, variant: "destructive" });
    }
  };

  const startProject = async (id: string) => {
    try {
      await apiRequest(`/start/${id}`, "POST");
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "running" } : p))
      );
      toast({ title: "Project started", description: "Container started successfully." });
    } catch (error: any) {
      toast({ title: "Failed to start project", description: error.message, variant: "destructive" });
    }
  };

  const restartProject = async (id: string) => {
    try {
       setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "building" } : p))
      );
      await apiRequest(`/restart/${id}`, "POST");
      fetchProjects();
      toast({ title: "Project restarted", description: "Container restarted successfully." });
    } catch (error: any) {
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "failed" } : p))
      );
      toast({ title: "Failed to restart project", description: error.message, variant: "destructive" });
    }
  };

  const refreshLogs = async (id: string) => {
    try {
      const logs = await apiRequest(`/logs/${id}`);
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, logs: logs.map((l: any) => l.message) } : p))
      );
    } catch (error) {
      console.error("Failed to fetch logs", error);
    }
  };

  const subscribeToLogs = useCallback((projectId: string, callback: (log: any) => void) => {
    if (!socket) return () => {};
    
    socket.emit("join-project", projectId);
    
    const handler = (data: any) => {
      callback(data);
    };

    socket.on("log", handler);

    return () => {
      socket.off("log", handler);
    };
  }, []);

  return (
    <ProjectContext.Provider
      value={{
        projects,
        isLoading,
        addProject,
        deleteProject,
        getProject,
        updateProject,
        deployProject,
        stopProject,
        startProject,
        restartProject,
        refreshLogs,
        subscribeToLogs,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export const useProjects = () => {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjects must be inside ProjectProvider");
  return ctx;
};
