import { useEffect, useState } from "react";
import { FolderGit2, Box, Cpu, MemoryStick } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { ProjectRow } from "@/components/ProjectRow";
import { useProjects } from "@/context/ProjectContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { apiRequest } from "@/lib/api";

interface SystemStats {
  cpu_usage: number;
  memory_usage: number;
  memory_total: number;
  memory_used: number;
}

export default function Dashboard() {
  const { projects } = useProjects();
  const running = projects.filter(p => p.status === "running").length;
  const [stats, setStats] = useState<SystemStats>({
    cpu_usage: 0,
    memory_usage: 0,
    memory_total: 0,
    memory_used: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await apiRequest("/system/stats");
        setStats(data);
      } catch (error) {
        console.error("Failed to fetch system stats", error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Infrastructure overview</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Projects" value={projects.length} icon={<FolderGit2 className="h-5 w-5" />} accent="primary" />
          <StatCard label="Running Containers" value={running} icon={<Box className="h-5 w-5" />} accent="success" />
          <StatCard label="CPU Usage" value={`${stats.cpu_usage}%`} icon={<Cpu className="h-5 w-5" />} accent="warning" />
          <StatCard label="Memory Usage" value={`${stats.memory_used} GB`} icon={<MemoryStick className="h-5 w-5" />} accent="primary" />
        </div>

        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-3">Recent Projects</h2>
          <div className="border border-border rounded-md overflow-hidden">
            {projects.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No projects yet.</p>
            ) : (
              projects.slice(0, 5).map(p => <ProjectRow key={p.id} project={p} />)
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
