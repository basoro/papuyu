import { Project } from "@/context/ProjectContext";
import { useNavigate } from "react-router-dom";
import { GitBranch } from "lucide-react";

const statusClasses: Record<string, string> = {
  running: "status-dot-running",
  building: "status-dot-building",
  stopped: "status-dot-stopped",
  failed: "status-dot-failed",
  idle: "status-dot-idle",
};

export function ProjectRow({ project }: { project: Project }) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/projects/${project.id}`)}
      className="w-full flex items-center gap-4 px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors duration-150 text-left papuyu-btn-active"
    >
      <span className={statusClasses[project.status] || "status-dot-idle"} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{project.name}</p>
        <p className="text-xs text-muted-foreground font-mono truncate">{project.git_repository}</p>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <GitBranch className="h-3 w-3" />
        <span className="font-mono">{project.branch}</span>
      </div>
      <span className="text-xs text-muted-foreground font-mono tabular-nums">:{project.port}</span>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground w-16 text-right">
        {project.status}
      </span>
    </button>
  );
}
