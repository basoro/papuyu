import {
  LayoutDashboard,
  FolderGit2,
  Rocket,
  Users,
  Settings,
  LogOut,
  Fish,
  Box,
  ShieldCheck,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Projects", url: "/projects", icon: FolderGit2 },
  { title: "Deployments", url: "/deployments", icon: Rocket },
];

const adminItems = [
  { title: "Users", url: "/users", icon: Users },
  { title: "Docker", url: "/admin/docker", icon: Box },
  { title: "WAF Dashboard", url: "/admin/waf", icon: ShieldCheck },
];

const bottomItems = [
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user, logout, isAdmin } = useAuth();

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent>
        {/* Brand */}
        <div className="flex items-center gap-2 px-4 h-16 border-b border-sidebar-border">
          <Fish className="h-6 w-6 text-primary flex-shrink-0" />
          {!collapsed && (
            <span className="text-lg font-bold tracking-tight text-foreground">
              Papuyu Project
            </span>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Platform
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="hover:bg-sidebar-accent transition-colors duration-150"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className="hover:bg-sidebar-accent transition-colors duration-150"
                        activeClassName="bg-sidebar-accent text-primary font-medium"
                      >
                        <item.icon className="mr-2 h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {bottomItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="hover:bg-sidebar-accent transition-colors duration-150"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {user && (
          <div className="flex items-center justify-between gap-2">
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-foreground truncate">{user.email}</span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{user.role}</span>
              </div>
            )}
            <button
              onClick={logout}
              className="p-1.5 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors duration-150"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
