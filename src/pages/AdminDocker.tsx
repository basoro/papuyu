import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Box, Layers, HardDrive, Network, Database, Server, RefreshCw, Terminal, Search } from "lucide-react";
import { Progress } from "@/components/ui/progress";

// Helper function to format bytes to GB/MB
function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function AdminDocker() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContainer, setSelectedContainer] = useState<any | null>(null);

  // Fetch Overview Data
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["dockerOverview"],
    queryFn: () => apiRequest("/api/system/docker/overview"),
  });

  // Fetch Containers Data
  const { data: containers, isLoading: containersLoading } = useQuery({
    queryKey: ["dockerContainers"],
    queryFn: () => apiRequest("/api/system/docker/containers"),
    refetchInterval: 5000, // Refresh every 5 seconds for real-time feel
  });

  // Container Action Mutation
  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      apiRequest(`/api/system/docker/containers/${id}/${action}`, "POST"),
    onSuccess: (data, variables) => {
      toast({
        title: "Action Successful",
        description: `Successfully sent ${variables.action} signal to container.`,
      });
      queryClient.invalidateQueries({ queryKey: ["dockerContainers"] });
    },
    onError: (error: any) => {
      toast({
        title: "Action Failed",
        description: error.message || "Failed to perform action on container.",
        variant: "destructive",
      });
    },
  });

  const filteredContainers = containers?.filter((c: any) => 
    c.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.image?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Docker Management</h1>
            <p className="text-muted-foreground mt-2">
              Monitor and manage containers, images, and resources across the platform.
            </p>
          </div>
          <Button variant="outline" size="icon" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["dockerOverview"] });
            queryClient.invalidateQueries({ queryKey: ["dockerContainers"] });
          }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Resource Overview */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Resource Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="flex flex-col space-y-1 p-4 bg-muted/40 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Containers</span>
                  <Box className="h-4 w-4 text-primary/60" />
                </div>
                <span className="text-2xl font-bold">{overview?.containers?.total || 0}</span>
              </div>
              
              <div className="flex flex-col space-y-1 p-4 bg-muted/40 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Compose</span>
                  <Layers className="h-4 w-4 text-primary/60" />
                </div>
                <span className="text-2xl font-bold">{overview?.compose?.total || 0}</span>
                <span className="text-xs text-muted-foreground">Projects</span>
              </div>

              <div className="flex flex-col space-y-1 p-4 bg-muted/40 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Images</span>
                  <HardDrive className="h-4 w-4 text-primary/60" />
                </div>
                <span className="text-2xl font-bold">{overview?.images?.total || 0}</span>
                <span className="text-xs text-muted-foreground">Used: {formatBytes(overview?.images?.size || 0)}</span>
              </div>

              <div className="flex flex-col space-y-1 p-4 bg-muted/40 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Networks</span>
                  <Network className="h-4 w-4 text-primary/60" />
                </div>
                <span className="text-2xl font-bold">{overview?.networks?.total || 0}</span>
              </div>

              <div className="flex flex-col space-y-1 p-4 bg-muted/40 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Volumes</span>
                  <Database className="h-4 w-4 text-primary/60" />
                </div>
                <span className="text-2xl font-bold">{overview?.volumes?.total || 0}</span>
              </div>

              <div className="flex flex-col space-y-1 p-4 bg-muted/40 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Registries</span>
                  <Server className="h-4 w-4 text-primary/60" />
                </div>
                <span className="text-2xl font-bold">{overview?.registries?.total || 1}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Container List Section */}
        <Card>
          <CardHeader className="pb-4 flex flex-row items-center justify-between border-b">
            <CardTitle className="text-lg">Container List</CardTitle>
            <div className="flex items-center space-x-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search container..."
                  className="w-64 pl-8"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {containersLoading ? (
              <div className="text-center py-10 text-muted-foreground">Loading containers...</div>
            ) : filteredContainers?.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">No containers found.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                {filteredContainers?.map((container: any) => (
                  <Card 
                    key={container.id} 
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => setSelectedContainer(container)}
                  >
                    <CardContent className="p-4 space-y-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-2 truncate">
                          <Terminal className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                          <div className="truncate">
                            <p className="font-semibold text-sm truncate" title={container.name}>
                              {container.name}
                            </p>
                            <p className="text-xs text-muted-foreground truncate" title={container.image}>
                              {container.image}
                            </p>
                          </div>
                        </div>
                        <div 
                          className={`h-2.5 w-2.5 rounded-full flex-shrink-0 mt-1 ${
                            container.state === 'running' ? 'bg-green-500' : 
                            container.state === 'exited' ? 'bg-red-500' : 'bg-yellow-500'
                          }`} 
                          title={container.state}
                        />
                      </div>
                      
                      <div className="text-xs text-muted-foreground">
                        Created at: {new Date(container.created * 1000).toLocaleString()}
                      </div>

                      <div className="space-y-3 pt-2">
                        {/* Fake CPU/RAM since basic systeminformation doesn't return real-time container stats without extra flags/calls. 
                            If available in container data, use it, else mock 0%. */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span>CPU</span>
                            <span>{container.cpuPercent ? container.cpuPercent.toFixed(2) : '0'}%</span>
                          </div>
                          <Progress value={container.cpuPercent || 0} className="h-1.5" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span>RAM</span>
                            <span>{formatBytes(container.memUsage || 0)}</span>
                          </div>
                          <Progress value={container.memPercent || 0} className="h-1.5" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Container Management Modal */}
        <Dialog open={!!selectedContainer} onOpenChange={(open) => !open && setSelectedContainer(null)}>
          <DialogContent className="max-w-4xl h-[600px] flex flex-col p-0 overflow-hidden">
            <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
              <DialogTitle>Container Manage [{selectedContainer?.name}]</DialogTitle>
            </DialogHeader>
            
            <div className="flex flex-1 overflow-hidden">
              {/* Sidebar */}
              <div className="w-64 border-r bg-muted/10 p-4 space-y-1 overflow-y-auto">
                {["Container status", "Container terminal", "Container details", "Storage volumes", "Container network", "Reboot strategy", "Create Image", "Rename", "Real-time logs", "Proxy"].map((item, i) => (
                  <Button 
                    key={item} 
                    variant={i === 0 ? "secondary" : "ghost"} 
                    className="w-full justify-start font-normal"
                  >
                    {item}
                  </Button>
                ))}
              </div>

              {/* Main Content Area */}
              <div className="flex-1 p-6 overflow-y-auto">
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-medium">Current Status:</span>
                      <span className={`capitalize ${
                        selectedContainer?.state === 'running' ? 'text-green-500' : 'text-red-500'
                      }`}>
                        {selectedContainer?.state}
                      </span>
                    </div>
                    <div className="space-x-2">
                      {selectedContainer?.state === 'running' ? (
                        <Button 
                          variant="outline" 
                          onClick={() => actionMutation.mutate({ id: selectedContainer.id, action: 'stop' })}
                          disabled={actionMutation.isPending}
                        >
                          Stop
                        </Button>
                      ) : (
                        <Button 
                          variant="outline" 
                          onClick={() => actionMutation.mutate({ id: selectedContainer.id, action: 'start' })}
                          disabled={actionMutation.isPending}
                        >
                          Start
                        </Button>
                      )}
                      <Button 
                        variant="outline"
                        onClick={() => actionMutation.mutate({ id: selectedContainer.id, action: 'restart' })}
                        disabled={actionMutation.isPending}
                      >
                        Restart
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-md">
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className="border-b">
                          <td className="p-3 bg-muted/30 font-medium w-1/3">Container name</td>
                          <td className="p-3">{selectedContainer?.name}</td>
                        </tr>
                        <tr className="border-b">
                          <td className="p-3 bg-muted/30 font-medium">Container ID</td>
                          <td className="p-3 break-all">{selectedContainer?.id}</td>
                        </tr>
                        <tr className="border-b">
                          <td className="p-3 bg-muted/30 font-medium">Image used</td>
                          <td className="p-3 break-all">{selectedContainer?.image} ({selectedContainer?.imageID})</td>
                        </tr>
                        <tr className="border-b">
                          <td className="p-3 bg-muted/30 font-medium">State</td>
                          <td className="p-3">{selectedContainer?.state}</td>
                        </tr>
                        <tr className="border-b">
                          <td className="p-3 bg-muted/30 font-medium">Creation time</td>
                          <td className="p-3">{selectedContainer?.created ? new Date(selectedContainer.created * 1000).toLocaleString() : '-'}</td>
                        </tr>
                        <tr className="border-b">
                          <td className="p-3 bg-muted/30 font-medium">Ports</td>
                          <td className="p-3">
                            {selectedContainer?.ports?.map((p: any, i: number) => (
                              <div key={i} className="text-blue-500">
                                {p.IP}:{p.PublicPort} --&gt; {p.PrivatePort}/{p.Type}
                              </div>
                            )) || 'No published ports'}
                          </td>
                        </tr>
                        <tr className="border-b">
                          <td className="p-3 bg-muted/30 font-medium">Networks</td>
                          <td className="p-3">
                            {selectedContainer?.networkSettings?.networks ? 
                              Object.keys(selectedContainer.networkSettings.networks).join(', ') : '-'}
                          </td>
                        </tr>
                        <tr>
                          <td className="p-3 bg-muted/30 font-medium">Command</td>
                          <td className="p-3 font-mono text-xs">{selectedContainer?.command}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
