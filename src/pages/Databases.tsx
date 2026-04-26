import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useProjects } from "@/context/ProjectContext";

interface ManagedDatabase {
  id: string;
  name: string;
  engine: "mysql";
  version: string;
  db_name: string;
  username: string;
  host: string;
  port: number;
  status: "provisioning" | "running" | "failed" | "stopped";
  user_id: number;
  owner_email?: string;
  created_at: string;
  attachment_count: number;
}

const statusClasses: Record<ManagedDatabase["status"], string> = {
  provisioning: "status-dot-building",
  running: "status-dot-running",
  failed: "status-dot-failed",
  stopped: "status-dot-stopped",
};

export default function DatabasesPage() {
  const [databases, setDatabases] = useState<ManagedDatabase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [dbName, setDbName] = useState("");
  const [username, setUsername] = useState("");
  const { toast } = useToast();
  const { projects, fetchProjects } = useProjects();

  const availableProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  );

  const fetchDatabases = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest("/databases");
      setDatabases(data);
    } catch (error: any) {
      toast({ title: "Failed to fetch databases", description: error.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchDatabases();
    fetchProjects();
  }, [fetchDatabases, fetchProjects]);

  const createDatabase = async () => {
    if (!name || !dbName || !username) {
      toast({ title: "Field wajib diisi", description: "Isi name, database name, dan username terlebih dahulu.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await apiRequest("/databases", "POST", {
        name,
        engine: "mysql",
        version: "8.0",
        db_name: dbName,
        username,
      });

      setDatabases((prev) => [created, ...prev]);
      setName("");
      setDbName("");
      setUsername("");
      toast({
        title: "Managed MySQL dibuat",
        description: `Host internal ${created.host}:${created.port} siap dipakai.`,
      });
    } catch (error: any) {
      toast({ title: "Gagal membuat database", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const attachDatabase = async (databaseId: string) => {
    const projectId = selectedProjects[databaseId];
    if (!projectId) {
      toast({ title: "Pilih project", description: "Pilih project tujuan sebelum attach database.", variant: "destructive" });
      return;
    }

    try {
      await apiRequest(`/databases/${databaseId}/attach`, "POST", { project_id: projectId, alias: "primary" });
      toast({
        title: "Database ter-attach",
        description: "Deploy ulang project agar env vars dan shared network diterapkan.",
      });
      fetchDatabases();
    } catch (error: any) {
      toast({ title: "Gagal attach database", description: error.message, variant: "destructive" });
    }
  };

  const deleteDatabase = async (databaseId: string) => {
    try {
      await apiRequest(`/databases/${databaseId}`, "DELETE");
      setDatabases((prev) => prev.filter((database) => database.id !== databaseId));
      toast({ title: "Database dihapus", description: "Managed database berhasil dibersihkan." });
    } catch (error: any) {
      toast({ title: "Gagal menghapus database", description: error.message, variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Managed Databases</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Managed MySQL internal yang bisa di-attach ke project Papuyu.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={fetchDatabases}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 p-4 border border-border rounded-md bg-card">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Resource Name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="mysql-main" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Database Name</Label>
            <Input value={dbName} onChange={(event) => setDbName(event.target.value)} placeholder="app_db" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">App Username</Label>
            <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="app_user" />
          </div>
          <div className="flex items-end">
            <Button onClick={createDatabase} disabled={isSubmitting} className="papuyu-btn-active w-full">
              <Plus className="h-4 w-4 mr-1" /> {isSubmitting ? "Creating..." : "Create MySQL"}
            </Button>
          </div>
        </div>

        <div className="border border-border rounded-md overflow-hidden">
          <div className="grid grid-cols-7 gap-4 px-4 py-2 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Database</span>
            <span>Status</span>
            <span>Connection</span>
            <span>Owner</span>
            <span>Attached</span>
            <span>Attach to Project</span>
            <span className="text-right">Actions</span>
          </div>

          {isLoading && (
            <div className="px-4 py-6 text-sm text-muted-foreground">Memuat managed databases...</div>
          )}

          {!isLoading && databases.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground">Belum ada managed database.</div>
          )}

          {!isLoading && databases.map((database) => (
            <div key={database.id} className="grid grid-cols-7 gap-4 px-4 py-3 border-b border-border last:border-0 items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Database className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm font-medium truncate">{database.name}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {database.engine} {database.version} / {database.db_name}
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span className={statusClasses[database.status]} />
                <span className="capitalize">{database.status}</span>
              </div>

              <div className="text-xs text-muted-foreground break-all">
                {database.host}:{database.port}
              </div>

              <div className="text-xs text-muted-foreground truncate">
                {database.owner_email || `User #${database.user_id}`}
              </div>

              <div className="text-xs text-muted-foreground">
                {database.attachment_count} project
                {database.attachment_count !== 1 ? "s" : ""}
              </div>

              <div>
                <div className="flex gap-2">
                  <select
                    value={selectedProjects[database.id] || ""}
                    onChange={(event) => setSelectedProjects((prev) => ({ ...prev, [database.id]: event.target.value }))}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Pilih project...</option>
                    {availableProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" onClick={() => attachDatabase(database.id)}>
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex justify-end">
                <Button size="icon" variant="ghost" onClick={() => deleteDatabase(database.id)} title="Delete database">
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
