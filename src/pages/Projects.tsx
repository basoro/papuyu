import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ProjectRow } from "@/components/ProjectRow";
import { useProjects } from "@/context/ProjectContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Plus, X, PlusCircle, Trash2, DownloadCloud, ShieldAlert, Copy } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type TemplateKey = "mysql" | "postgres" | "redis";
type EnvVar = { key: string; value: string };

interface TemplateDefinition {
  path: string;
  content: string;
  port: string;
  envVars: EnvVar[];
}

interface QuickTemplate {
  label: string;
  dockerfile: TemplateDefinition;
  compose: TemplateDefinition;
}

const QUICK_TEMPLATES: Record<TemplateKey, QuickTemplate> = {
  mysql: {
    label: "MySQL",
    dockerfile: {
      path: "Dockerfile",
      port: "3306",
      content: `FROM mysql:8.0

ENV TZ=\${TZ}
ENV MYSQL_ROOT_PASSWORD=\${MYSQL_ROOT_PASSWORD}
ENV MYSQL_DATABASE=\${MYSQL_DATABASE}
ENV MYSQL_USER=\${MYSQL_USER}
ENV MYSQL_PASSWORD=\${MYSQL_PASSWORD}

COPY ./init-scripts/ /docker-entrypoint-initdb.d/

EXPOSE 3306`,
      envVars: [
        { key: "TZ", value: "Asia/Jakarta" },
        { key: "MYSQL_ROOT_PASSWORD", value: "change-this-root-password" },
        { key: "MYSQL_DATABASE", value: "app_db" },
        { key: "MYSQL_USER", value: "app_user" },
        { key: "MYSQL_PASSWORD", value: "change-this-user-password" },
      ],
    },
    compose: {
      path: "docker-compose.yml",
      port: "80",
      content: `version: "3.8"

services:
  db:
    image: mysql:8.0
    restart: unless-stopped
    command:
      - --default-authentication-plugin=mysql_native_password
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --skip-name-resolve
      - --max_connections=200
    environment:
      TZ: \${TZ}
      MYSQL_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: \${MYSQL_DATABASE}
      MYSQL_USER: \${MYSQL_USER}
      MYSQL_PASSWORD: \${MYSQL_PASSWORD}
    volumes:
      - db_data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -p\${MYSQL_ROOT_PASSWORD} || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 40s

  web:
    image: phpmyadmin/phpmyadmin:latest
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      TZ: \${TZ}
      PMA_HOST: db
      PMA_PORT: 3306
      PMA_USER: \${MYSQL_USER}
      PMA_PASSWORD: \${MYSQL_PASSWORD}
      PMA_ABSOLUTE_URI: \${PMA_ABSOLUTE_URI}
      PMA_ARBITRARY: 0
      UPLOAD_LIMIT: \${UPLOAD_LIMIT}
      MEMORY_LIMIT: \${PMA_MEMORY_LIMIT}
      MAX_EXECUTION_TIME: \${PMA_MAX_EXECUTION_TIME}

volumes:
  db_data:
`,
      envVars: [
        { key: "TZ", value: "Asia/Jakarta" },
        { key: "MYSQL_ROOT_PASSWORD", value: "change-this-root-password" },
        { key: "MYSQL_DATABASE", value: "app_db" },
        { key: "MYSQL_USER", value: "app_user" },
        { key: "MYSQL_PASSWORD", value: "change-this-user-password" },
        { key: "PMA_ABSOLUTE_URI", value: "https://dbadmin.example.com/" },
        { key: "UPLOAD_LIMIT", value: "256M" },
        { key: "PMA_MEMORY_LIMIT", value: "512M" },
        { key: "PMA_MAX_EXECUTION_TIME", value: "120" },
      ],
    },
  },
  postgres: {
    label: "Postgres",
    dockerfile: {
      path: "Dockerfile",
      port: "5432",
      content: `FROM postgres:16-alpine

ENV TZ=\${TZ}
ENV POSTGRES_DB=\${POSTGRES_DB}
ENV POSTGRES_USER=\${POSTGRES_USER}
ENV POSTGRES_PASSWORD=\${POSTGRES_PASSWORD}

COPY ./init-scripts/ /docker-entrypoint-initdb.d/

EXPOSE 5432`,
      envVars: [
        { key: "TZ", value: "Asia/Jakarta" },
        { key: "POSTGRES_DB", value: "app_db" },
        { key: "POSTGRES_USER", value: "app_user" },
        { key: "POSTGRES_PASSWORD", value: "change-this-postgres-password" },
      ],
    },
    compose: {
      path: "docker-compose.yml",
      port: "80",
      content: `version: "3.8"

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      TZ: \${TZ}
      POSTGRES_DB: \${POSTGRES_DB}
      POSTGRES_USER: \${POSTGRES_USER}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER} -d \${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s

  web:
    image: dpage/pgadmin4:latest
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      TZ: \${TZ}
      PGADMIN_DEFAULT_EMAIL: \${PGADMIN_DEFAULT_EMAIL}
      PGADMIN_DEFAULT_PASSWORD: \${PGADMIN_DEFAULT_PASSWORD}
      PGADMIN_CONFIG_ENHANCED_COOKIE_PROTECTION: "True"
      PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED: "False"

volumes:
  pg_data:
`,
      envVars: [
        { key: "TZ", value: "Asia/Jakarta" },
        { key: "POSTGRES_DB", value: "app_db" },
        { key: "POSTGRES_USER", value: "app_user" },
        { key: "POSTGRES_PASSWORD", value: "change-this-postgres-password" },
        { key: "PGADMIN_DEFAULT_EMAIL", value: "admin@example.com" },
        { key: "PGADMIN_DEFAULT_PASSWORD", value: "change-this-pgadmin-password" },
      ],
    },
  },
  redis: {
    label: "Redis",
    dockerfile: {
      path: "Dockerfile",
      port: "6379",
      content: `FROM redis:7-alpine

ENV REDIS_PASSWORD=\${REDIS_PASSWORD}

CMD ["sh", "-c", "redis-server --appendonly yes --requirepass \\"$REDIS_PASSWORD\\""]

EXPOSE 6379`,
      envVars: [
        { key: "REDIS_PASSWORD", value: "change-this-redis-password" },
      ],
    },
    compose: {
      path: "docker-compose.yml",
      port: "8081",
      content: `version: "3.8"

services:
  db:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "\${REDIS_PASSWORD}"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "\${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s

  web:
    image: rediscommander/redis-commander:latest
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      TZ: \${TZ}
      REDIS_HOSTS: local:db:6379:0:\${REDIS_PASSWORD}
      HTTP_USER: \${REDIS_COMMANDER_USER}
      HTTP_PASSWORD: \${REDIS_COMMANDER_PASSWORD}

volumes:
  redis_data:
`,
      envVars: [
        { key: "TZ", value: "Asia/Jakarta" },
        { key: "REDIS_PASSWORD", value: "change-this-redis-password" },
        { key: "REDIS_COMMANDER_USER", value: "admin" },
        { key: "REDIS_COMMANDER_PASSWORD", value: "change-this-commander-password" },
      ],
    },
  },
};

function cloneEnvVars(envVars: EnvVar[]) {
  return envVars.map((env) => ({ ...env }));
}

const createInitialForm = () => ({
  name: "",
  git_repository: "",
  branch: "main",
  project_type: "dockerfile",
  dockerfile_path: "Dockerfile",
  dockerfile_source: "repo" as "repo" | "upload" | "textarea",
  dockerfile_content: "",
  compose_file: "docker-compose.yml",
  compose_source: "repo" as "repo" | "upload" | "textarea",
  compose_content: "",
  port: "80",
  env_vars: [] as { key: string; value: string }[],
  subdomain: "",
  waf_enabled: false,
  ram_limit: "0",
});

export default function Projects() {
  const { projects, addProject } = useProjects();
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingEnv, setLoadingEnv] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>("mysql");
  const { toast } = useToast();

  const serverIp = import.meta.env.VITE_SERVER_IP;
  const envDomain = import.meta.env.VITE_BASE_DOMAIN;
  const baseDomain = envDomain && envDomain !== 'localhost' && envDomain !== serverIp ? envDomain : (serverIp ? `${serverIp}.nip.io` : 'localhost');
  const additionalDomainsStr = import.meta.env.VITE_ADDITIONAL_DOMAINS;
  const additionalDomains = additionalDomainsStr ? additionalDomainsStr.split(',').map((d: string) => d.trim()).filter(Boolean) : [];
  
  const [selectedDomain, setSelectedDomain] = useState<string>(baseDomain);
  const [form, setForm] = useState(createInitialForm);

  const activeSource = form.project_type === "dockerfile" ? form.dockerfile_source : form.compose_source;
  const usesRepository = activeSource === "repo";
  const activeTemplate = QUICK_TEMPLATES[selectedTemplate];
  const activeTemplateDefinition = form.project_type === "dockerfile" ? activeTemplate.dockerfile : activeTemplate.compose;
  const activeTemplateEnvVars = form.project_type === "dockerfile" ? activeTemplate.dockerfile.envVars : activeTemplate.compose.envVars;
  const activeTemplateEnvText = activeTemplateEnvVars.map((env) => `${env.key}=${env.value}`).join("\n");

  const handleDefinitionUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      setForm((prev) => {
        if (prev.project_type === "dockerfile") {
          return {
            ...prev,
            dockerfile_source: "upload",
            dockerfile_content: content,
            dockerfile_path: prev.dockerfile_path === "Dockerfile" ? file.name || "Dockerfile" : prev.dockerfile_path,
          };
        }

        return {
          ...prev,
          compose_source: "upload",
          compose_content: content,
          compose_file: prev.compose_file === "docker-compose.yml" ? file.name || "docker-compose.yml" : prev.compose_file,
        };
      });
      toast({
        title: form.project_type === "dockerfile" ? "Dockerfile loaded" : "Compose file loaded",
        description: `${file.name} siap digunakan untuk build.`,
      });
    } catch (error) {
      toast({ title: "Gagal membaca file", description: "Pastikan file definisi container dapat dibaca sebagai teks.", variant: "destructive" });
    } finally {
      event.target.value = "";
    }
  };

  const handleCreate = async () => {
    if (!form.name) {
      toast({ title: "Nama wajib diisi", description: "Isi nama project terlebih dahulu.", variant: "destructive" });
      return;
    }

    if (usesRepository && !form.git_repository.trim()) {
      toast({ title: "Git Repository diperlukan", description: "Mode Use File From Repo membutuhkan repository Git.", variant: "destructive" });
      return;
    }

    if (form.project_type === "dockerfile" && form.dockerfile_source !== "repo" && !form.dockerfile_content.trim()) {
      toast({ title: "Dockerfile diperlukan", description: "Upload file atau isi Dockerfile di textarea terlebih dahulu.", variant: "destructive" });
      return;
    }

    if (form.project_type === "compose" && form.compose_source !== "repo" && !form.compose_content.trim()) {
      toast({ title: "Compose file diperlukan", description: "Upload file atau isi Docker Compose di textarea terlebih dahulu.", variant: "destructive" });
      return;
    }
    
    let finalSubdomain = form.subdomain;
    if (finalSubdomain && selectedDomain !== 'custom' && selectedDomain !== baseDomain) {
      finalSubdomain = `${finalSubdomain}.${selectedDomain}`;
    }

    setLoading(true);
    await addProject({
      name: form.name,
      git_repository: usesRepository ? form.git_repository : "",
      branch: usesRepository ? form.branch : "main",
      project_type: form.project_type as "dockerfile" | "compose",
      dockerfile_path: form.dockerfile_path,
      dockerfile_source: form.project_type === "dockerfile" ? form.dockerfile_source : "repo",
      dockerfile_content: form.project_type === "dockerfile" && form.dockerfile_source !== "repo" ? form.dockerfile_content : undefined,
      compose_file: form.compose_file,
      compose_source: form.project_type === "compose" ? form.compose_source : "repo",
      compose_content: form.project_type === "compose" && form.compose_source !== "repo" ? form.compose_content : undefined,
      port: parseInt(form.port) || 3000,
      env_vars: form.env_vars,
      subdomain: finalSubdomain || undefined,
      waf_enabled: form.waf_enabled,
      ram_limit: form.ram_limit ? parseInt(form.ram_limit) : 0,
    });
    setLoading(false);
    setForm(createInitialForm());
    setSelectedDomain(baseDomain);
    setShowForm(false);
  };

  const addEnvVar = () => {
    setForm({ ...form, env_vars: [...form.env_vars, { key: "", value: "" }] });
  };

  const applyQuickTemplate = () => {
    setForm((prev) => {
      const nextForm = {
        ...prev,
        port: activeTemplateDefinition.port,
        env_vars: cloneEnvVars(activeTemplateEnvVars),
      };

      if (prev.project_type === "dockerfile") {
        return {
          ...nextForm,
          dockerfile_path: activeTemplateDefinition.path,
          dockerfile_source: "textarea" as const,
          dockerfile_content: activeTemplateDefinition.content,
        };
      }

      return {
        ...nextForm,
        compose_file: activeTemplateDefinition.path,
        compose_source: "textarea" as const,
        compose_content: activeTemplateDefinition.content,
      };
    });

    toast({
      title: "Template diterapkan",
      description: `${activeTemplate.label} untuk ${form.project_type === "dockerfile" ? "Dockerfile" : "Compose"} sudah mengisi textarea dan environment variables.`,
    });
  };

  const applyEnvTemplate = () => {
    setForm((prev) => ({
      ...prev,
      env_vars: cloneEnvVars(activeTemplateEnvVars),
    }));

    toast({
      title: "Environment template diterapkan",
      description: `${activeTemplateEnvVars.length} environment variables template telah dimasukkan ke form.`,
    });
  };

  const copyEnvTemplate = async () => {
    try {
      await navigator.clipboard.writeText(activeTemplateEnvText);
      toast({
        title: "Env template disalin",
        description: `Template ${activeTemplate.label} siap di-paste.`,
      });
    } catch {
      toast({
        title: "Gagal menyalin",
        description: "Clipboard tidak tersedia. Silakan copy manual dari textarea template.",
        variant: "destructive",
      });
    }
  };

  const removeEnvVar = (index: number) => {
    const newVars = [...form.env_vars];
    newVars.splice(index, 1);
    setForm({ ...form, env_vars: newVars });
  };

  const updateEnvVar = (index: number, field: "key" | "value", value: string) => {
    const newVars = [...form.env_vars];
    newVars[index][field] = value;
    setForm({ ...form, env_vars: newVars });
  };

  const loadEnvFromRepo = async () => {
    if (!form.git_repository) {
      toast({ title: "Error", description: "Please enter Git Repository URL first", variant: "destructive" });
      return;
    }

    setLoadingEnv(true);
    try {
      // Convert github repo url to raw content url for .env
      // e.g. https://github.com/user/repo.git -> https://raw.githubusercontent.com/user/repo/main/.env
      let rawUrl = form.git_repository;
      
      // Remove .git extension
      if (rawUrl.endsWith('.git')) rawUrl = rawUrl.slice(0, -4);
      
      // Handle GitHub URLs
      if (rawUrl.includes('github.com')) {
        rawUrl = rawUrl.replace('github.com', 'raw.githubusercontent.com');
        
        // Determine path for .env file
        let envPath = '.env';
        if (form.project_type === 'compose' && form.compose_file) {
            // Extract directory from compose file path
            // e.g. "docker/docker-compose.yml" -> "docker/"
            const lastSlashIndex = form.compose_file.lastIndexOf('/');
            if (lastSlashIndex !== -1) {
                envPath = `${form.compose_file.substring(0, lastSlashIndex)}/.env`;
            }
        } else if (form.project_type === 'dockerfile' && form.dockerfile_path) {
             const lastSlashIndex = form.dockerfile_path.lastIndexOf('/');
             if (lastSlashIndex !== -1) {
                 envPath = `${form.dockerfile_path.substring(0, lastSlashIndex)}/.env`;
             }
        }

        rawUrl += `/${form.branch}/${envPath}`;
      } else {
        // Fallback or generic logic could go here
        toast({ title: "Info", description: "Only GitHub repositories are auto-supported for .env loading currently.", variant: "default" });
        setLoadingEnv(false);
        return;
      }

      const res = await apiRequest('/projects/parse-env', 'POST', { url: rawUrl });
      
      if (res.envs && res.envs.length > 0) {
        // Merge with existing envs, overwriting duplicates
        const existingKeys = new Set(form.env_vars.map(e => e.key));
        const newEnvs = [...form.env_vars];
        
        res.envs.forEach((e: { key: string; value: string }) => {
          if (!existingKeys.has(e.key)) {
            newEnvs.push(e);
          }
        });
        
        setForm({ ...form, env_vars: newEnvs });
        toast({ title: "Success", description: `Loaded ${res.envs.length} variables from .env` });
      } else {
        // Fallback try .env.example
        if (!rawUrl.endsWith('.example')) {
            const exampleUrl = rawUrl + '.example';
            console.log("Trying fallback:", exampleUrl);
            try {
                const resExample = await apiRequest('/projects/parse-env', 'POST', { url: exampleUrl });
                if (resExample.envs && resExample.envs.length > 0) {
                    const existingKeys = new Set(form.env_vars.map(e => e.key));
                    const newEnvs = [...form.env_vars];
                    
                    resExample.envs.forEach((e: { key: string; value: string }) => {
                      if (!existingKeys.has(e.key)) {
                        newEnvs.push(e);
                      }
                    });
                    
                    setForm({ ...form, env_vars: newEnvs });
                    toast({ title: "Success", description: `Loaded ${resExample.envs.length} variables from .env.example` });
                    setLoadingEnv(false);
                    return;
                }
            } catch (e) {
                // Ignore error from fallback
            }
        }
        
        toast({ title: "Warning", description: "No variables found or .env file is empty/missing" });
      }
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Failed to load .env file. Make sure it exists in the repo.", variant: "destructive" });
    }
    setLoadingEnv(false);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
          </div>
          <Button
            onClick={() => setShowForm(!showForm)}
            size="sm"
            className="papuyu-btn-active"
          >
            {showForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            {showForm ? "Cancel" : "New Project"}
          </Button>
        </div>

        {showForm && (
          <div className="border border-border rounded-md p-4 space-y-4 bg-card">
            <h3 className="text-sm font-medium">Create Project</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input placeholder="my-app" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-background" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{selectedDomain === 'custom' ? 'Custom Domain (TLD)' : 'Subdomain (Optional)'}</Label>
                <div className="flex items-center gap-2">
                    <Input 
                      placeholder={selectedDomain === 'custom' ? "example.com" : "subdomain"} 
                      value={form.subdomain} 
                      onChange={e => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, '') })} 
                      className="bg-background font-mono text-sm" 
                    />
                    <Select value={selectedDomain} onValueChange={setSelectedDomain}>
                      <SelectTrigger className="w-[180px] bg-background text-xs h-9">
                        <SelectValue placeholder="Select domain" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={baseDomain}>.{baseDomain}</SelectItem>
                        {additionalDomains.map((domain: string) => (
                          <SelectItem key={domain} value={domain}>.{domain}</SelectItem>
                        ))}
                        <SelectItem value="custom">Custom TLD</SelectItem>
                      </SelectContent>
                    </Select>
                </div>
              </div>
              {usesRepository && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Git Repository</Label>
                    <Input placeholder="https://github.com/user/repo.git" value={form.git_repository} onChange={e => setForm({ ...form, git_repository: e.target.value })} className="bg-background font-mono text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Branch</Label>
                    <Input placeholder="main" value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })} className="bg-background font-mono text-sm" />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Project Type</Label>
                <Select 
                  value={form.project_type} 
                  onValueChange={val =>
                    setForm({
                      ...form,
                      project_type: val,
                      dockerfile_source: val === "dockerfile" ? form.dockerfile_source : "repo",
                      compose_source: val === "compose" ? form.compose_source : "repo",
                    })
                  }
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dockerfile">Dockerfile</SelectItem>
                    <SelectItem value="compose">Docker Compose</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Quick Template</Label>
                <Select value={selectedTemplate} onValueChange={(value: TemplateKey) => setSelectedTemplate(value)}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Pilih template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mysql">MySQL</SelectItem>
                    <SelectItem value="postgres">Postgres</SelectItem>
                    <SelectItem value="redis">Redis</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs text-muted-foreground">Template Actions</Label>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={applyQuickTemplate}>
                    Terapkan {activeTemplate.label}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={applyEnvTemplate}>
                    Terapkan Env Template
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={copyEnvTemplate}>
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    Copy Env Template
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Template cepat akan mengisi textarea, path file, container port, dan daftar environment variables sesuai pilihan.
                </p>
              </div>

              {form.project_type === "dockerfile" ? (
                <div className="space-y-4 sm:col-span-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Dockerfile Path</Label>
                      <Input placeholder="Dockerfile" value={form.dockerfile_path} onChange={e => setForm({ ...form, dockerfile_path: e.target.value })} className="bg-background font-mono text-sm" />
                      <p className="text-[10px] text-muted-foreground">Lokasi file Dockerfile di dalam workspace build hasil clone repo.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Dockerfile Source</Label>
                      <Select
                        value={form.dockerfile_source}
                        onValueChange={(value: "repo" | "upload" | "textarea") =>
                          setForm({
                            ...form,
                            dockerfile_source: value,
                            dockerfile_content: value === "repo" ? "" : form.dockerfile_content,
                          })
                        }
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Select source" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="repo">Use file from repo path</SelectItem>
                          <SelectItem value="upload">Upload Dockerfile</SelectItem>
                          <SelectItem value="textarea">Paste in textarea</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {form.dockerfile_source !== "repo" && (
                    <div className="space-y-3 rounded-md border border-border p-3 bg-muted/20">
                      {form.dockerfile_source === "upload" && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Upload Dockerfile</Label>
                          <Input type="file" accept=".dockerfile,.txt,text/plain" onChange={handleDefinitionUpload} className="bg-background text-sm" />
                          <p className="text-[10px] text-muted-foreground">Setelah diupload, isi file akan muncul di textarea dan masih bisa Anda edit.</p>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Dockerfile Content</Label>
                        <Textarea
                          placeholder={"FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000"}
                          value={form.dockerfile_content}
                          onChange={(e) => setForm({ ...form, dockerfile_content: e.target.value })}
                          className="min-h-[220px] bg-background font-mono text-xs"
                        />
                        <p className="text-[10px] text-muted-foreground">Konten ini akan ditulis ke `dockerfile_path` sebelum proses build dijalankan.</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4 sm:col-span-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Compose File</Label>
                      <Input placeholder="docker-compose.yml" value={form.compose_file} onChange={e => setForm({ ...form, compose_file: e.target.value })} className="bg-background font-mono text-sm" />
                      <p className="text-[10px] text-muted-foreground">Lokasi file Docker Compose di dalam workspace build.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Compose Source</Label>
                      <Select
                        value={form.compose_source}
                        onValueChange={(value: "repo" | "upload" | "textarea") =>
                          setForm({
                            ...form,
                            compose_source: value,
                            compose_content: value === "repo" ? "" : form.compose_content,
                          })
                        }
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Select source" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="repo">Use file from repo</SelectItem>
                          <SelectItem value="upload">Upload Compose file</SelectItem>
                          <SelectItem value="textarea">Paste in textarea</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {form.compose_source !== "repo" && (
                    <div className="space-y-3 rounded-md border border-border p-3 bg-muted/20">
                      {form.compose_source === "upload" && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Upload Compose File</Label>
                          <Input type="file" accept=".yml,.yaml,.txt,text/plain" onChange={handleDefinitionUpload} className="bg-background text-sm" />
                          <p className="text-[10px] text-muted-foreground">Setelah diupload, isi file akan muncul di textarea dan masih bisa Anda edit.</p>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Compose Content</Label>
                        <Textarea
                          placeholder={"services:\n  db:\n    image: mysql:8.0\n    ports:\n      - \"3306:3306\""}
                          value={form.compose_content}
                          onChange={(e) => setForm({ ...form, compose_content: e.target.value })}
                          className="min-h-[220px] bg-background font-mono text-xs"
                        />
                        <p className="text-[10px] text-muted-foreground">Konten ini akan ditulis ke `compose_file` sebelum `docker compose up` dijalankan.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Container Port (Internal)</Label>
                <Input type="number" placeholder="3000" value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} className="bg-background font-mono text-sm" />
                <p className="text-[10px] text-muted-foreground">Port dimana aplikasi berjalan (misal: 80 untuk Nginx, 3000 untuk Node)</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">RAM Limit (MB)</Label>
                <Input type="number" placeholder="0" value={form.ram_limit} onChange={e => setForm({ ...form, ram_limit: e.target.value })} className="bg-background font-mono text-sm" />
                <p className="text-[10px] text-muted-foreground">
                  {user?.role === 'user' ? "Maksimal 256MB untuk akun User." : 
                   user?.role === 'client' ? "Maksimal 512MB untuk akun Client." : 
                   "Batas memori (0 = tanpa batas). Contoh: 512 untuk 512MB."}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-primary" />
                    <Label className="text-sm font-medium">Enable Web Application Firewall (WAF)</Label>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    Protects your app from SQLi, XSS, and common attacks using ModSecurity. <br/>
                    <span className="text-amber-500">Warning: May block complex API payloads or large file uploads.</span>
                  </p>
                </div>
                <Switch 
                  checked={form.waf_enabled} 
                  onCheckedChange={checked => setForm({ ...form, waf_enabled: checked })} 
                />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Env Template ({activeTemplate.label})</Label>
                  <Button type="button" size="sm" variant="ghost" onClick={copyEnvTemplate} className="h-6 text-xs">
                    <Copy className="h-3 w-3 mr-1" />
                    Copy List
                  </Button>
                </div>
                <Textarea
                  readOnly
                  value={activeTemplateEnvText}
                  className="min-h-[120px] bg-muted/20 font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">Format `KEY=VALUE` ini siap di-copy sebagai referensi, lalu bisa langsung diterapkan ke form lewat tombol template env.</p>
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Environment Variables</Label>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={loadEnvFromRepo} disabled={loadingEnv || !usesRepository} className="h-6 text-xs">
                    <DownloadCloud className="h-3 w-3 mr-1" />
                    {loadingEnv ? "Loading..." : "Load from Repo"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={addEnvVar} className="h-6 text-xs">
                    <PlusCircle className="h-3 w-3 mr-1" /> Add Variable
                  </Button>
                </div>
              </div>
              
              {form.env_vars.length === 0 && (
                <p className="text-[10px] text-muted-foreground italic">No environment variables added.</p>
              )}

              {form.env_vars.map((env, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Input 
                    placeholder="KEY" 
                    value={env.key} 
                    onChange={e => updateEnvVar(idx, 'key', e.target.value)} 
                    className="h-8 text-xs font-mono flex-1 bg-background" 
                  />
                  <Input 
                    placeholder="VALUE" 
                    value={env.value} 
                    onChange={e => updateEnvVar(idx, 'value', e.target.value)} 
                    className="h-8 text-xs font-mono flex-1 bg-background" 
                  />
                  <Button size="sm" variant="ghost" onClick={() => removeEnvVar(idx)} className="h-8 w-8 p-0 text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <Button onClick={handleCreate} size="sm" className="papuyu-btn-active w-full" disabled={loading}>
              {loading ? "Provisioning..." : "Provision Project"}
            </Button>
          </div>
        )}

        <div className="border border-border rounded-md overflow-hidden">
          {projects.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">No projects. Create one to get started.</p>
          ) : (
            projects.map(p => <ProjectRow key={p.id} project={p} />)
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
