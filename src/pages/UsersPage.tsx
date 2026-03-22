import { useState, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Users as UsersIcon, Edit2, X, Check } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface User {
  id: number;
  email: string;
  role: string;
  created_at: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editPassword, setEditPassword] = useState("");
  
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
      await apiRequest("/users", "POST", { email: newEmail, password: newPassword, role: newRole });
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

  const updateUser = async (id: number) => {
    try {
      const payload: any = { role: editRole };
      if (editPassword) {
        payload.password = editPassword;
      }
      
      await apiRequest(`/users/${id}`, "PUT", payload);
      toast({ title: "User updated", description: "User modified successfully." });
      setEditingUserId(null);
      setEditPassword("");
      fetchUsers();
    } catch (error: any) {
      toast({ title: "Failed to update user", description: error.message, variant: "destructive" });
    }
  };

  const startEditing = (user: User) => {
    setEditingUserId(user.id);
    setEditRole(user.role);
    setEditPassword("");
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
          <div className="flex gap-2 items-end p-4 border border-border rounded-md bg-card flex-wrap">
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input 
                placeholder="user@example.com" 
                value={newEmail} 
                onChange={e => setNewEmail(e.target.value)} 
                className="bg-background" 
              />
            </div>
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label className="text-xs text-muted-foreground">Password</Label>
              <Input 
                type="password"
                placeholder="password" 
                value={newPassword} 
                onChange={e => setNewPassword(e.target.value)} 
                className="bg-background" 
              />
            </div>
            <div className="w-32 space-y-1.5">
              <Label className="text-xs text-muted-foreground">Role</Label>
              <select 
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={newRole}
                onChange={e => setNewRole(e.target.value)}
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
              
              {editingUserId === u.id ? (
                <div className="flex gap-2 items-center col-span-2">
                  <select 
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                    value={editRole}
                    onChange={e => setEditRole(e.target.value)}
                  >
                    <option value="user">User</option>
                    <option value="client">Client</option>
                    <option value="admin">Admin</option>
                  </select>
                  <Input 
                    type="password"
                    placeholder="New password (optional)" 
                    value={editPassword} 
                    onChange={e => setEditPassword(e.target.value)} 
                    className="h-8 text-xs bg-background max-w-[150px]" 
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-green-500" onClick={() => updateUser(u.id)}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setEditingUserId(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{u.role}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{new Date(u.created_at).toLocaleDateString()}</span>
                </>
              )}

              <div className="text-right">
                {u.role !== "admin" && editingUserId !== u.id && (
                  <div className="flex justify-end gap-1">
                    <button onClick={() => startEditing(u)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => removeUser(u.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
