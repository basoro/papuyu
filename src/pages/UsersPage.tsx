import { useState, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Users as UsersIcon } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface User {
  id: number;
  email: string;
  role: "admin" | "client" | "user";
  created_at: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const { toast } = useToast();

  const fetchUsers = useCallback(async () => {
    try {
      const data = await apiRequest("/users");
      setUsers(data);
    } catch (error) {
      console.error("Failed to fetch users", error);
      toast({ title: "Failed to fetch users", variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const addUser = async () => {
    if (!newEmail || !newPassword) return;
    try {
      await apiRequest("/auth/register", "POST", { email: newEmail, password: newPassword, role: newRole });
      toast({ title: "User created", description: "User added successfully." });
      setNewEmail("");
      setNewPassword("");
      setNewRole("user");
      setShowAdd(false);
      fetchUsers();
    } catch (error: any) {
      toast({ title: "Failed to create user", description: error.message, variant: "destructive" });
    }
  };

  const removeUser = async (id: number) => {
    try {
      await apiRequest(`/users/${id}`, "DELETE");
      setUsers(prev => prev.filter(u => u.id !== id));
      toast({ title: "User removed", description: "User deleted successfully." });
    } catch (error: any) {
      toast({ title: "Failed to remove user", description: error.message, variant: "destructive" });
    }
  };

  const changeRole = async (id: number, newRole: "admin" | "client" | "user") => {
    try {
      await apiRequest(`/users/${id}/role`, "PUT", { role: newRole });
      setUsers(prev => prev.map(u => u.id === id ? { ...u, role: newRole } : u));
      toast({ title: "Role updated", description: `User role changed to ${newRole}.` });
    } catch (error: any) {
      toast({ title: "Failed to update role", description: error.message, variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Users</h1>
            <p className="text-sm text-muted-foreground mt-1">{users.length} registered user{users.length !== 1 ? "s" : ""}</p>
          </div>
          <Button size="sm" onClick={() => setShowAdd(!showAdd)} className="papuyu-btn-active">
            <Plus className="h-4 w-4 mr-1" /> Add User
          </Button>
        </div>

        {showAdd && (
          <div className="flex gap-2 items-end p-4 border border-border rounded-md bg-card">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input 
                placeholder="user@example.com" 
                value={newEmail} 
                onChange={e => setNewEmail(e.target.value)} 
                className="bg-background" 
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs text-muted-foreground">Password</Label>
              <Input 
                type="password"
                placeholder="password" 
                value={newPassword} 
                onChange={e => setNewPassword(e.target.value)} 
                className="bg-background" 
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs text-muted-foreground">Role</Label>
              <select 
                value={newRole} 
                onChange={e => setNewRole(e.target.value)}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="user">User</option>
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <Button size="sm" onClick={addUser} className="papuyu-btn-active h-10">Create</Button>
          </div>
        )}

        <div className="border border-border rounded-md overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-4 gap-4 px-4 py-2 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Email</span>
            <span>Role</span>
            <span>Created</span>
            <span className="text-right">Actions</span>
          </div>
          {users.map(u => (
            <div key={u.id} className="grid grid-cols-4 gap-4 px-4 py-3 border-b border-border last:border-0 items-center">
              <div className="flex items-center gap-2 min-w-0">
                <UsersIcon className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <span className="text-sm truncate">{u.email}</span>
              </div>
              <div className="flex items-center">
                {u.role === "admin" ? (
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Admin</span>
                ) : (
                  <select 
                    value={u.role}
                    onChange={(e) => changeRole(u.id, e.target.value as "admin" | "client" | "user")}
                    className="bg-background text-[10px] uppercase tracking-widest text-foreground border border-border rounded px-2 py-1"
                  >
                    <option value="user">User (256MB)</option>
                    <option value="client">Client (512MB)</option>
                    <option value="admin">Admin (Unlmt)</option>
                  </select>
                )}
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">{new Date(u.created_at).toLocaleDateString()}</span>
              <div className="text-right">
                {u.role !== "admin" && (
                  <button onClick={() => removeUser(u.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
