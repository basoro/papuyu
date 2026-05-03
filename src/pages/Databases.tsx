import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Database, Eye, EyeOff, Globe, Link2, Plus, RefreshCw, Settings2, Trash2, Wand2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useProjects } from "@/context/ProjectContext";
import { useAuth } from "@/context/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ManagedDatabase {
  id: string;
  name: string;
  engine: "mysql";
  version: string;
  db_name: string;
  username: string;
  host: string;
  port: number;
  public_access_enabled?: boolean;
  public_subdomain?: string | null;
  public_port?: number;
  public_tls_enabled?: boolean;
  public_host?: string | null;
  public_allowed_ips?: string | null;
  public_allowed_ips_list?: string[];
  status: "provisioning" | "running" | "failed" | "stopped";
  user_id: number;
  owner_email?: string;
  created_at: string;
  attachment_count: number;
  attachments?: {
    id: number;
    alias: string;
    project_id: string;
    project_name: string;
  }[];
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
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<Record<string, string>>({});
  const [detachTarget, setDetachTarget] = useState<{ databaseId: string; projectId: string; projectName: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ databaseId: string; databaseName: string } | null>(null);
  const [editTarget, setEditTarget] = useState<ManagedDatabase | null>(null);
  const [name, setName] = useState("");
  const [dbName, setDbName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [editPublicAccessEnabled, setEditPublicAccessEnabled] = useState(false);
  const [editPublicSubdomain, setEditPublicSubdomain] = useState("");
  const [editPublicAllowedIps, setEditPublicAllowedIps] = useState("");
  const { toast } = useToast();
  const { projects, fetchProjects } = useProjects();
  const { user } = useAuth();

  const serverIp = import.meta.env.VITE_SERVER_IP;
  const envDomain = import.meta.env.VITE_BASE_DOMAIN;
  const baseDomain = envDomain && envDomain !== 'localhost' && envDomain !== serverIp ? envDomain : (serverIp ? `${serverIp}.nip.io` : 'localhost');
  const additionalDomainsStr = import.meta.env.VITE_ADDITIONAL_DOMAINS;
  const additionalDomains = additionalDomainsStr ? additionalDomainsStr.split(',').map((d: string) => d.trim()).filter(Boolean) : [];

  const [selectedDomain, setSelectedDomain] = useState<string>(baseDomain);
  const isPuskesmas = user?.role === 'puskesmas';

  useEffect(() => {
    if (user?.role === 'puskesmas') {
      setSelectedDomain('puskesmas.online');
    }
  }, [user?.role]);

  const availableProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  );

  const hasProvisioningDatabase = useMemo(
    () => databases.some((database) => database.status === "provisioning"),
    [databases]
  );

  const fetchDatabases = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoading(true);
    }
    try {
      const data = await apiRequest("/databases");
      setDatabases(data);
    } catch (error: any) {
      if (!options?.silent) {
        toast({ title: "Failed to fetch databases", description: error.message, variant: "destructive" });
      }
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  }, [toast]);

  useEffect(() => {
    fetchDatabases();
    fetchProjects();
  }, [fetchDatabases, fetchProjects]);

  useEffect(() => {
    if (!hasProvisioningDatabase) {
      return;
    }

    const interval = window.setInterval(() => {
      void fetchDatabases({ silent: true });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [fetchDatabases, hasProvisioningDatabase]);

  const generatePassword = useCallback(() => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
    const array = new Uint32Array(20);
    crypto.getRandomValues(array);
    const generated = Array.from(array, (value) => alphabet[value % alphabet.length]).join("");
    setPassword(generated);
    setShowPassword(true);
  }, []);

  const copyPassword = useCallback(async () => {
    if (!password) {
      toast({ title: "Password kosong", description: "Generate atau isi password terlebih dahulu.", variant: "destructive" });
      return;
    }

    try {
      await navigator.clipboard.writeText(password);
      toast({ title: "Password disalin", description: "Password MySQL berhasil disalin ke clipboard." });
    } catch {
      toast({ title: "Gagal menyalin", description: "Clipboard tidak tersedia di browser ini.", variant: "destructive" });
    }
  }, [password, toast]);

  const createDatabase = async () => {
    if (!name || !dbName || !username || !password) {
      toast({ title: "Field wajib diisi", description: "Isi name, database name, username, dan password terlebih dahulu.", variant: "destructive" });
      return;
    }

    if (password.length < 8) {
      toast({ title: "Password terlalu pendek", description: "Gunakan password minimal 8 karakter untuk MySQL.", variant: "destructive" });
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
        password,
      });

      setDatabases((prev) => [{ ...created, attachments: [] }, ...prev]);
      setName("");
      setDbName("");
      setUsername("");
      setPassword("");
      toast({
        title: "Managed MySQL dibuat",
        description: `Host internal ${created.host}:${created.port} siap dipakai. Aktifkan akses publik nanti lewat tombol Edit Public Access.`,
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

  const detachDatabase = async (databaseId: string, projectId: string) => {
    setIsActionSubmitting(true);
    try {
      await apiRequest(`/databases/${databaseId}/detach`, "POST", { project_id: projectId });
      toast({
        title: "Database dilepas",
        description: "Attachment database ke project berhasil dilepas.",
      });
      setDetachTarget(null);
      fetchDatabases({ silent: true });
    } catch (error: any) {
      toast({ title: "Gagal detach database", description: error.message, variant: "destructive" });
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const deleteDatabase = async (databaseId: string) => {
    setIsActionSubmitting(true);
    try {
      await apiRequest(`/databases/${databaseId}`, "DELETE");
      setDatabases((prev) => prev.filter((database) => database.id !== databaseId));
      toast({ title: "Database dihapus", description: "Managed database berhasil dibersihkan." });
      setDeleteTarget(null);
    } catch (error: any) {
      toast({ title: "Gagal menghapus database", description: error.message, variant: "destructive" });
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const openPublicAccessEditor = (database: ManagedDatabase) => {
    setEditTarget(database);
    setEditPublicAccessEnabled(Boolean(database.public_access_enabled));
    
    // Try to parse subdomain and domain
    let sub = database.public_subdomain || "";
    let dom = baseDomain;
    
    if (sub.includes('.')) {
      const parts = sub.split('.');
      const possibleSub = parts[0];
      const possibleDom = parts.slice(1).join('.');
      
      if (additionalDomains.includes(possibleDom)) {
        sub = possibleSub;
        dom = possibleDom;
      } else if (possibleDom === baseDomain) {
        sub = possibleSub;
        dom = baseDomain;
      } else {
        dom = 'custom';
        // keep sub as is
      }
    }
    
    setEditPublicSubdomain(sub);
    setSelectedDomain(dom);
    setEditPublicAllowedIps((database.public_allowed_ips_list || []).join("\n"));
  };

  const updatePublicAccess = async () => {
    if (!editTarget) return;
    if (editPublicAccessEnabled && !editPublicSubdomain.trim()) {
      toast({ title: "Public Subdomain wajib diisi", description: "Isi subdomain publik jika ingin mengaktifkan akses publik.", variant: "destructive" });
      return;
    }

    setIsActionSubmitting(true);
    try {
      let finalSubdomain = editPublicSubdomain.trim();
      if (finalSubdomain && selectedDomain !== 'custom' && selectedDomain !== baseDomain) {
        finalSubdomain = `${finalSubdomain}.${selectedDomain}`;
      }

      await apiRequest(`/databases/${editTarget.id}/public-access`, "PUT", {
        public_access_enabled: editPublicAccessEnabled,
        public_subdomain: editPublicAccessEnabled ? finalSubdomain : undefined,
        public_allowed_ips: editPublicAccessEnabled ? editPublicAllowedIps : undefined,
      });
      toast({
        title: "Public access diperbarui",
        description: "Database masuk ke status provisioning sampai konfigurasi Traefik TCP dan container selesai diterapkan.",
      });
      setEditTarget(null);
      void fetchDatabases({ silent: true });
    } catch (error: any) {
      toast({ title: "Gagal memperbarui public access", description: error.message, variant: "destructive" });
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const copyConnectionInfo = async (database: ManagedDatabase, mode: "internal" | "public" | "mysql-cli") => {
    const text = mode === "internal"
      ? `MYSQL_HOST=${database.host}\nMYSQL_PORT=${database.port}\nMYSQL_DATABASE=${database.db_name}\nMYSQL_USER=${database.username}`
      : mode === "public"
        ? (database.public_host
            ? `MYSQL_PUBLIC_HOST=${database.public_host}\nMYSQL_PUBLIC_PORT=${database.public_port}\nMYSQL_SSL_MODE=REQUIRED`
            : "")
        : database.public_host
          ? `mysql -h ${database.public_host} -P ${database.public_port || 3306} -u ${database.username} -p --ssl-mode=REQUIRED`
          : "";

    if (!text) {
      toast({ title: "Connection info belum tersedia", description: "Public host belum aktif untuk database ini.", variant: "destructive" });
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Connection info disalin",
        description:
          mode === "internal"
            ? "Info koneksi internal siap dipaste."
            : mode === "public"
              ? "Info koneksi publik siap dipaste."
              : "Command MySQL CLI siap dipaste.",
      });
    } catch {
      toast({ title: "Gagal menyalin", description: "Clipboard tidak tersedia di browser ini.", variant: "destructive" });
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
          <Button size="sm" variant="outline" onClick={() => { void fetchDatabases(); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="space-y-4 p-4 border border-border rounded-md bg-card">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
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
          <div className="space-y-1.5 xl:col-span-2">
            <Label className="text-xs text-muted-foreground">App Password</Label>
            <div className="space-y-2">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimal 8 karakter"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => setShowPassword((prev) => !prev)}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </Button>
                <Button type="button" size="icon" variant="outline" onClick={() => void copyPassword()} title="Copy password">
                  <Copy className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" onClick={generatePassword} title="Generate password otomatis">
                  <Wand2 className="h-4 w-4 mr-1" /> Generate
                </Button>
              </div>
            </div>
          </div>
          <div className="flex items-end xl:col-span-1">
            <Button onClick={createDatabase} disabled={isSubmitting} className="papuyu-btn-active w-full">
              <Plus className="h-4 w-4 mr-1" /> {isSubmitting ? "Creating..." : "Create MySQL"}
            </Button>
          </div>
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
                  {database.public_access_enabled && (
                    <span className="text-[10px] uppercase tracking-widest text-emerald-500 border border-emerald-500/30 px-2 py-0.5 rounded-sm">
                      Public
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {database.engine} {database.version} / {database.db_name}
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span className={statusClasses[database.status]} />
                <span className="capitalize">{database.status}</span>
              </div>

              <div className="text-xs text-muted-foreground break-all space-y-1">
                <div>Internal: {database.host}:{database.port}</div>
                {database.public_access_enabled && database.public_host && (
                  <div>
                    Public: {database.public_host}:{database.public_port} {database.public_tls_enabled ? "(TLS)" : ""}
                  </div>
                )}
                {database.public_access_enabled && (database.public_allowed_ips_list?.length || 0) > 0 && (
                  <div>Allowlist: {database.public_allowed_ips_list?.join(", ")}</div>
                )}
              </div>

              <div className="text-xs text-muted-foreground truncate">
                {database.owner_email || `User #${database.user_id}`}
              </div>

              <div className="text-xs text-muted-foreground space-y-2">
                <div>
                  {database.attachment_count} project
                  {database.attachment_count !== 1 ? "s" : ""}
                </div>
                {(database.attachments?.length || 0) > 0 ? (
                  <div className="space-y-1">
                    {database.attachments?.map((attachment) => (
                      <div key={attachment.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                        <span className="truncate">{attachment.project_name}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => setDetachTarget({
                            databaseId: database.id,
                            projectId: attachment.project_id,
                            projectName: attachment.project_name,
                          })}
                        >
                          Detach
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>Belum ada attachment.</div>
                )}
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
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void copyConnectionInfo(database, "internal")}
                  title="Copy internal connection info"
                >
                  <Copy className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => openPublicAccessEditor(database)}
                  title="Edit public access"
                >
                  {database.public_access_enabled ? (
                    <Globe className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Settings2 className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void copyConnectionInfo(database, "public")}
                  title="Copy public connection info"
                  disabled={!database.public_access_enabled || !database.public_host}
                >
                  <Copy className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void copyConnectionInfo(database, "mysql-cli")}
                  title="Copy MySQL CLI command"
                  disabled={!database.public_access_enabled || !database.public_host}
                >
                  <Globe className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setDeleteTarget({ databaseId: database.id, databaseName: database.name })}
                  title={database.attachment_count > 0 ? "Detach semua project dulu" : "Delete database"}
                  disabled={database.attachment_count > 0}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AlertDialog open={!!detachTarget} onOpenChange={(open) => !open && !isActionSubmitting && setDetachTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach Database?</AlertDialogTitle>
            <AlertDialogDescription>
              Database akan dilepas dari project `{detachTarget?.projectName}`. Project itu tidak akan lagi menerima env vars managed database pada deploy berikutnya.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionSubmitting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={isActionSubmitting || !detachTarget}
              onClick={(event) => {
                event.preventDefault();
                if (!detachTarget) return;
                void detachDatabase(detachTarget.databaseId, detachTarget.projectId);
              }}
            >
              {isActionSubmitting ? "Memproses..." : "Ya, Detach"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && !isActionSubmitting && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Public Access MySQL</DialogTitle>
            <DialogDescription>
              Ubah akses publik untuk managed MySQL ini. Perubahan akan mereprovision container dengan volume yang sama, jadi database tetap persisten tetapi akan restart singkat.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label className="text-sm">Expose Publicly</Label>
                <p className="text-xs text-muted-foreground mt-1">Traefik TCP + TLS diperlukan untuk koneksi MySQL dari internet.</p>
              </div>
              <Switch checked={editPublicAccessEnabled} onCheckedChange={setEditPublicAccessEnabled} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{selectedDomain === 'custom' ? 'Custom Domain (TLD)' : 'Public Subdomain'}</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={editPublicSubdomain}
                  onChange={(event) => setEditPublicSubdomain(event.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ""))}
                  placeholder={selectedDomain === 'custom' ? "example.com" : "mysql-main"}
                  disabled={!editPublicAccessEnabled}
                  className="bg-background font-mono text-sm"
                />
                <Select value={selectedDomain} onValueChange={setSelectedDomain} disabled={!editPublicAccessEnabled}>
                  <SelectTrigger className="w-[180px] bg-background text-xs h-9">
                    <SelectValue placeholder="Select domain" />
                  </SelectTrigger>
                  <SelectContent>
                    {!isPuskesmas && <SelectItem value={baseDomain}>.{baseDomain}</SelectItem>}
                    {additionalDomains
                      .filter((domain: string) => !isPuskesmas || domain === 'puskesmas.online')
                      .map((domain: string) => (
                        <SelectItem key={domain} value={domain}>.{domain}</SelectItem>
                      ))}
                    <SelectItem value="custom">Custom TLD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[10px] text-amber-500">
                Gunakan client MySQL dengan TLS, misalnya `--ssl-mode=REQUIRED`, dan pastikan entrypoint TCP Traefik sudah aktif di server.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Allowed IPs / CIDR</Label>
              <textarea
                value={editPublicAllowedIps}
                onChange={(event) => setEditPublicAllowedIps(event.target.value)}
                placeholder={"203.0.113.10/32\n198.51.100.0/24"}
                disabled={!editPublicAccessEnabled}
                className="flex min-h-[110px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Opsional. Jika diisi, hanya IP atau CIDR ini yang boleh melewati Traefik TCP ke MySQL publik.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={isActionSubmitting}>
              Batal
            </Button>
            <Button onClick={() => void updatePublicAccess()} disabled={isActionSubmitting}>
              {isActionSubmitting ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !isActionSubmitting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Database?</AlertDialogTitle>
            <AlertDialogDescription>
              Database `{deleteTarget?.databaseName}` beserta container dan volume persistennya akan dihapus permanen. Pastikan tidak ada data yang masih dibutuhkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionSubmitting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={isActionSubmitting || !deleteTarget}
              onClick={(event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                void deleteDatabase(deleteTarget.databaseId);
              }}
            >
              {isActionSubmitting ? "Menghapus..." : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
