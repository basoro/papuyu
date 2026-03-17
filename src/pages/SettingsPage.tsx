import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/context/AuthContext";

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Platform configuration</p>
        </div>

        <div className="border border-border rounded-md divide-y divide-border">
          <SettingRow label="Email" value={user?.email || "—"} />
          <SettingRow label="Role" value={user?.role || "—"} />
          <SettingRow label="Docker Socket" value="/var/run/docker.sock" mono />
          <SettingRow label="Database" value="SQLite — papuyu.db" mono />
          <SettingRow label="Version" value="v0.1.0-alpha" mono />
        </div>

        <div className="text-xs text-muted-foreground">
          Papuyu is a self-hosted PaaS for container deployment.
        </div>
      </div>
    </DashboardLayout>
  );
}

function SettingRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm text-foreground ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
