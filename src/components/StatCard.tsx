import { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  accent?: "primary" | "success" | "warning" | "destructive";
}

const accentMap = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

export function StatCard({ label, value, icon, accent = "primary" }: StatCardProps) {
  return (
    <div className="flex items-center gap-4 p-4 border border-border rounded-md bg-card">
      <div className={`${accentMap[accent]}`}>{icon}</div>
      <div>
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
      </div>
    </div>
  );
}
