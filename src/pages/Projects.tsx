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
import { Plus, X, PlusCircle, Trash2, DownloadCloud, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export default function Projects() {
  const { projects, addProject } = useProjects();
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingEnv, setLoadingEnv] = useState(false);
  const { toast } = useToast();

  const serverIp = import.meta.env.VITE_SERVER_IP;
  const envDomain = import.meta.env.VITE_BASE_DOMAIN;
  const baseDomain = envDomain && envDomain !== 'localhost' && envDomain !== serverIp ? envDomain : (serverIp ? `${serverIp}.nip.io` : 'localhost');
  const additionalDomainsStr = import.meta.env.VITE_ADDITIONAL_DOMAINS;
  const additionalDomains = additionalDomainsStr ? additionalDomainsStr.split(',').map((d: string) => d.trim()).filter(Boolean) : [];
  
  const [selectedDomain, setSelectedDomain] = useState<string>(baseDomain);
  const [form, setForm] = useState({
    name: "",
    git_repository: "",
    branch: "main",
    project_type: "dockerfile", // "dockerfile" | "compose"
    dockerfile_path: "Dockerfile",
    compose_file: "docker-compose.yml",
    port: "80",
    env_vars: [] as { key: string; value: string }[],
    subdomain: "",
    waf_enabled: false,
    ram_limit: "0",
  });

  const handleCreate = async () => {
    if (!form.name || !form.git_repository) return;
    
    let finalSubdomain = form.subdomain;
    if (finalSubdomain && selectedDomain !== 'custom' && selectedDomain !== baseDomain) {
      finalSubdomain = `${finalSubdomain}.${selectedDomain}`;
    }

    setLoading(true);
    await addProject({
      name: form.name,
      git_repository: form.git_repository,
      branch: form.branch,
      project_type: form.project_type as "dockerfile" | "compose",
      dockerfile_path: form.dockerfile_path,
      compose_file: form.compose_file,
      port: parseInt(form.port) || 3000,
      env_vars: form.env_vars,
      subdomain: finalSubdomain || undefined,
      waf_enabled: form.waf_enabled,
      ram_limit: form.ram_limit ? parseInt(form.ram_limit) : 0,
    });
    setLoading(false);
    setForm({ 
      name: "", 
      git_repository: "", 
      branch: "main", 
      project_type: "dockerfile",
      dockerfile_path: "Dockerfile", 
      compose_file: "docker-compose.yml",
      port: "80",
      env_vars: [],
      subdomain: "",
      waf_enabled: false,
      ram_limit: "0",
    });
    setSelectedDomain(baseDomain);
    setShowForm(false);
  };

  const addEnvVar = () => {
    setForm({ ...form, env_vars: [...form.env_vars, { key: "", value: "" }] });
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
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Git Repository</Label>
                <Input placeholder="https://github.com/user/repo.git" value={form.git_repository} onChange={e => setForm({ ...form, git_repository: e.target.value })} className="bg-background font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Branch</Label>
                <Input placeholder="main" value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })} className="bg-background font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Project Type</Label>
                <Select 
                  value={form.project_type} 
                  onValueChange={val => setForm({ ...form, project_type: val })}
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

              {form.project_type === "dockerfile" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Dockerfile Path</Label>
                  <Input placeholder="Dockerfile" value={form.dockerfile_path} onChange={e => setForm({ ...form, dockerfile_path: e.target.value })} className="bg-background font-mono text-sm" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Compose File</Label>
                  <Input placeholder="docker-compose.yml" value={form.compose_file} onChange={e => setForm({ ...form, compose_file: e.target.value })} className="bg-background font-mono text-sm" />
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
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Environment Variables</Label>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={loadEnvFromRepo} disabled={loadingEnv} className="h-6 text-xs">
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
