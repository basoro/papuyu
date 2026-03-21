import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Terminal } from "@/components/Terminal";
import { useProjects } from "@/context/ProjectContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Square, RotateCcw, Trash2, GitBranch, ExternalLink, Rocket } from "lucide-react";

const statusClasses: Record<string, string> = {
  running: "status-dot-running",
  building: "status-dot-building",
  stopped: "status-dot-stopped",
  failed: "status-dot-failed",
  idle: "status-dot-idle",
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getProject, deployProject, stopProject, startProject, restartProject, deleteProject, refreshLogs, subscribeToLogs } = useProjects();
  const project = getProject(id || "");

  useEffect(() => {
    if (project?.id) {
      refreshLogs(project.id);
      
      const unsubscribe = subscribeToLogs(project.id, (log) => {
        // Optimistically update logs (optional, or wait for polling if preferred, 
        // but real-time is better)
        // Note: logs state in context might need a setter exposed or handled via event
        refreshLogs(project.id);
      });

      return () => unsubscribe();
    }
  }, [project?.id, refreshLogs, subscribeToLogs]);

  if (!project) {
    return (
      <DashboardLayout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Project not found.</p>
          <Button variant="ghost" className="mt-4" onClick={() => navigate("/projects")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Projects
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const handleDelete = async () => {
    if (confirm("Are you sure you want to delete this project?")) {
      await deleteProject(project.id);
      navigate("/projects");
    }
  };

  // backend logic canonicalId: raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
  const safeProjectId = project.id.replace(/_/g, '-');
  const serverIp = import.meta.env.VITE_SERVER_IP;
  // If VITE_BASE_DOMAIN is set, use it. Otherwise, fallback to nip.io IP or localhost.
  const envDomain = import.meta.env.VITE_BASE_DOMAIN;
  const baseDomain = envDomain && envDomain !== 'localhost' && envDomain !== serverIp ? envDomain : (serverIp ? `${serverIp}.nip.io` : 'localhost');
  const protocol = import.meta.env.VITE_FORCE_HTTPS === 'true' ? 'https' : 'http';
  
  const publicUrl = `${protocol}://${project.subdomain || safeProjectId}.${baseDomain}`;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/projects")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className={statusClasses[project.status]} />
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground border border-border px-2 py-0.5 rounded-sm">
            {project.status}
          </span>
          {project.status === 'running' && (
             <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-sm text-primary hover:underline">
               <ExternalLink className="h-4 w-4" />
               Open App
             </a>
          )}
        </div>

        {/* Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <InfoRow label="Repository" value={project.git_repository} mono />
          <InfoRow label="Branch" value={project.branch} mono icon={<GitBranch className="h-3 w-3" />} />
          <InfoRow label="Internal Port" value={`${project.port}`} mono />
          <InfoRow label="Public URL" value={publicUrl} mono icon={<ExternalLink className="h-3 w-3" />} link={publicUrl} />
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={() => deployProject(project.id)}
            disabled={project.status === "building"}
            className="papuyu-btn-active"
          >
            <Rocket className="h-3 w-3 mr-1" /> Deploy
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => startProject(project.id)}
            disabled={project.status !== "stopped" && project.status !== "failed" && project.status !== "idle"}
            className="papuyu-btn-active"
          >
            <Play className="h-3 w-3 mr-1" /> Start
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => restartProject(project.id)}
            disabled={project.status !== "running"}
            className="papuyu-btn-active"
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Restart
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => stopProject(project.id)}
            disabled={project.status !== "running" && project.status !== "building"}
            className="papuyu-btn-active"
          >
            <Square className="h-3 w-3 mr-1" /> Stop
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleDelete}
            className="papuyu-btn-active ml-auto"
          >
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
        </div>

        {/* Logs */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-3">Container Logs</h2>
          <Terminal logs={project.logs} />
        </div>

        {/* Meta */}
        <div className="text-xs text-muted-foreground font-mono">
          ID: {project.id} · Created: {new Date(project.created_at).toLocaleString()}
        </div>
      </div>
    </DashboardLayout>
  );
}

function InfoRow({ label, value, mono, icon, link }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode, link?: string }) {
  return (
    <div className="p-3 border border-border rounded-md bg-card overflow-hidden">
      <p className="stat-label mb-1">{label}</p>
      <div className="flex items-center gap-1">
        {icon}
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className={`text-sm text-primary hover:underline truncate ${mono ? "font-mono" : ""}`}>
            {value}
          </a>
        ) : (
          <p className={`text-sm text-foreground truncate ${mono ? "font-mono" : ""}`}>{value}</p>
        )}
      </div>
    </div>
  );
}
