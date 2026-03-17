import { DashboardLayout } from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { Rocket } from "lucide-react";

export default function Deployments() {
  const { projects } = useProjects();
  const deployedProjects = projects.filter(p => p.status !== "idle");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Deployments</h1>
          <p className="text-sm text-muted-foreground mt-1">Deployment activity log</p>
        </div>

        <div className="border border-border rounded-md overflow-hidden">
          {deployedProjects.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">No deployments yet.</p>
          ) : (
            deployedProjects.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
                <Rocket className="h-4 w-4 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{p.git_repository}</p>
                </div>
                <span className={`text-[10px] uppercase tracking-widest ${p.status === "running" ? "text-success" : p.status === "building" ? "text-warning" : "text-muted-foreground"}`}>
                  {p.status}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {new Date(p.created_at).toLocaleDateString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
