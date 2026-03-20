import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell
} from "recharts";
import { ShieldAlert, Activity, Globe, HardDrive, Filter, Clock, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const API_URL = import.meta.env.VITE_API_URL || 'https://api.rshd.my.id';

const topPages = [
  { page: '/service-worker.js', count: 2021, percentage: 100 },
  { page: '/manifest.json', count: 2003, percentage: 95 },
  { page: '/admin/rawat_inap...', count: 1640, percentage: 80 },
  { page: '/admin/dashboard', count: 557, percentage: 30 },
  { page: '/themes/admin...', count: 454, percentage: 25 },
];

const mapStats = [
  { ip: '103.253.27.24', times: 14, country: 'Singapore' },
  { ip: '207.180.243.111', times: 2, country: 'Germany' },
  { ip: '142.93.211.25', times: 1, country: 'India' },
  { ip: '114.122.208.223', times: 1, country: 'Indonesia' },
];

export default function AdminWaf() {
  const [dateFilter, setDateFilter] = useState("Today");
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { token } = useAuth();

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/system/waf/stats`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch WAF stats', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const totalBlocks = stats?.totalBlocksToday || 0;
  const pieData = stats?.blockTypes?.map((b: any, i: number) => ({
    name: b.name,
    value: b.value,
    color: ['#22c55e', '#3b82f6', '#f97316', '#ef4444', '#a855f7'][i % 5]
  })) || [{ name: 'No data', value: 1, color: '#e5e7eb' }];

  const topDomains = stats?.topDomains?.map((d: any) => ({
    domain: d.domain,
    count: d.count,
    percentage: Math.min((d.count / (stats.topDomains[0]?.count || 1)) * 100, 100)
  })) || [];

  const topIps = stats?.topIps?.map((ip: any) => ({
    ip: ip.ip,
    count: ip.count,
    percentage: Math.min((ip.count / (stats.topIps[0]?.count || 1)) * 100, 100)
  })) || [];

  const latestBlocks = stats?.latestEvents?.map((e: any) => ({
    time: new Date(e.timestamp).toLocaleString(),
    ip: e.ip_address,
    domain: e.domain,
    type: e.attack_type,
    url: e.url
  })) || [];

  // Mock data for charts
  const timeData = Array.from({ length: 24 }).map((_, i) => ({
    time: `${String(i).padStart(2, '0')}:00`,
    total: Math.floor(Math.random() * 500) + 100,
    afterFilter: Math.floor(Math.random() * 450) + 50,
  }));

  const miniChartData = Array.from({ length: 10 }).map((_, i) => ({
    time: `11:08:${i * 5}`,
    value: Math.floor(Math.random() * 15) + 2,
  }));

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1600px] mx-auto pb-10">
        
        {/* Header / Date Filter */}
        <div className="flex justify-between items-center bg-card text-card-foreground p-2 rounded-lg border shadow-sm">
          <div className="flex space-x-1">
            {["Yesterday", "Today"].map(filter => (
              <Button 
                key={filter}
                variant={dateFilter === filter ? "default" : "ghost"}
                size="sm"
                onClick={() => setDateFilter(filter)}
                className={dateFilter === filter ? "bg-blue-500 hover:bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}
              >
                {filter}
              </Button>
            ))}
            <div className="relative flex items-center">
              <span className="text-sm text-muted-foreground ml-4 px-2 border-l border-border">Select Date 📅</span>
            </div>
          </div>
          <div className="flex items-center text-blue-500 font-medium">
            <Clock className="w-4 h-4 mr-2" />
            0
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          
          {/* LEFT COLUMN (3 cols) */}
          <div className="col-span-12 lg:col-span-3 space-y-4">
            
            {/* Overview Stats */}
            <div className="grid grid-cols-2 gap-2">
              <Card className="shadow-sm border-t-4 border-t-blue-500">
                <CardContent className="p-4">
                  <div className="flex items-center space-x-2 text-blue-500 mb-2">
                    <div className="w-1 h-4 bg-blue-500 rounded"></div>
                    <span className="font-semibold text-sm">Request</span>
                  </div>
                  <div className="text-3xl font-bold mb-1">99,164</div>
                  <div className="text-xs text-blue-500 flex items-center">
                    ↓ -66.65%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Yesterday: 297339</div>
                </CardContent>
              </Card>
              
              <Card className="shadow-sm border-t-4 border-t-red-500 relative overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-center space-x-2 text-red-500 mb-2">
                    <div className="w-1 h-4 bg-red-500 rounded"></div>
                    <span className="font-semibold text-sm">Malicious request</span>
                  </div>
                  <div className="text-3xl font-bold mb-1">{totalBlocks}</div>
                  <div className="text-xs text-red-500 flex items-center">
                    ↓ -76.92%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Yesterday: 78</div>
                  <ShieldAlert className="absolute right-[-10px] bottom-[-10px] w-20 h-20 text-muted-foreground opacity-20" />
                </CardContent>
              </Card>
            </div>

            {/* Mini Charts */}
            <Card className="shadow-sm">
              <CardHeader className="p-4 pb-0">
                <CardTitle className="text-sm text-muted-foreground flex items-center">
                  <Activity className="w-4 h-4 mr-2" /> Real-time QPS: 2/s
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2 h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={miniChartData}>
                    <defs>
                      <linearGradient id="colorGreen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" hide />
                    <YAxis hide domain={[0, 'dataMax + 5']} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#colorGreen)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="p-4 pb-0">
                <CardTitle className="text-sm text-muted-foreground flex items-center">
                  <Globe className="w-4 h-4 mr-2" /> Real-time traffic: 86.27 KB/s
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2 h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={miniChartData}>
                    <defs>
                      <linearGradient id="colorGreen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" hide />
                    <YAxis hide domain={[0, 'dataMax + 5']} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#colorGreen)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="p-4 pb-0">
                <CardTitle className="text-sm text-muted-foreground flex items-center">
                  <HardDrive className="w-4 h-4 mr-2" /> Real-time origin response: 0ms
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2 h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={miniChartData}>
                    <defs>
                      <linearGradient id="colorGreen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" hide />
                    <YAxis hide domain={[0, 'dataMax + 5']} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#colorGreen)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="p-4 pb-2 border-b">
                <CardTitle className="text-sm text-foreground flex items-center">
                  <ShieldAlert className="w-4 h-4 mr-2" /> Attacked domains TOP10
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {topDomains.map((d, i) => (
                  <div key={i} className="flex items-center text-xs">
                    <div className="w-5 h-5 rounded-full bg-green-500 text-white flex items-center justify-center mr-3 flex-shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 truncate mr-2 text-foreground" title={d.domain}>{d.domain}</div>
                    <div className="w-24 mr-3">
                      <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 transition-all" style={{ width: `${d.percentage}%` }}></div>
                      </div>
                    </div>
                    <div className="text-muted-foreground w-6 text-right">{d.count}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="p-4 pb-2 border-b">
                <CardTitle className="text-sm text-foreground flex items-center">
                  <ShieldAlert className="w-4 h-4 mr-2" /> Block type
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 flex items-center h-[200px]">
                <div className="w-1/2 h-full relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-xs text-muted-foreground">Today's blocks</span>
                    <span className="text-2xl font-bold">{totalBlocks}</span>
                  </div>
                </div>
                <div className="w-1/2 space-y-3 pl-4">
                  {pieData.map((d, i) => (
                    <div key={i} className="flex items-center text-xs text-foreground">
                      <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: d.color }}></div>
                      <span className="truncate flex-1">{d.name}</span>
                      <span className="font-medium">{d.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* RIGHT COLUMN (9 cols) */}
          <div className="col-span-12 lg:col-span-9 space-y-4">
            
            {/* Main Traffic Chart */}
            <Card className="shadow-sm">
              <CardHeader className="p-4 pb-0 border-b flex flex-row items-center justify-between">
                <CardTitle className="text-sm text-foreground flex items-center">
                  <Filter className="w-4 h-4 mr-2" /> Traffic filtering request chart
                </CardTitle>
                <Button variant="ghost" size="icon" className="h-6 w-6"><RefreshCw className="h-3 w-3" /></Button>
              </CardHeader>
              <CardContent className="p-4 h-[250px]">
                <div className="flex justify-center space-x-6 mb-4 text-xs">
                  <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-green-500 mr-2"></div>Total requests</div>
                  <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-blue-400 mr-2"></div>After filtering</div>
                  <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-cyan-300 mr-2"></div>Traffic</div>
                  <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-purple-500 mr-2"></div>IP count</div>
                </div>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorFilter" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{fontSize: 10}} tickLine={false} axisLine={false} />
                    <YAxis tick={{fontSize: 10}} tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="total" stroke="#22c55e" strokeWidth={1.5} fillOpacity={1} fill="url(#colorTotal)" />
                    <Area type="monotone" dataKey="afterFilter" stroke="#3b82f6" strokeWidth={1.5} fillOpacity={1} fill="url(#colorFilter)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Map & Map Stats */}
            <Card className="shadow-sm">
              <CardHeader className="p-4 pb-2 border-b flex flex-row items-center justify-between">
                <CardTitle className="text-sm text-foreground flex items-center">
                  <Globe className="w-4 h-4 mr-2" /> Access/Block Map
                </CardTitle>
                <div className="flex items-center space-x-4">
                  <div className="flex bg-muted rounded p-0.5">
                    <button className="px-3 py-1 text-xs bg-background shadow-sm rounded">3D</button>
                    <button className="px-3 py-1 text-xs text-muted-foreground">2D</button>
                  </div>
                  <div className="flex bg-muted rounded p-0.5">
                    <button className="px-3 py-1 text-xs text-muted-foreground">Requests</button>
                    <button className="px-3 py-1 text-xs bg-blue-500 text-white rounded">Blocks</button>
                  </div>
                  <a href="#" className="text-xs text-blue-500 hover:underline">Today's Block report &gt;&gt;</a>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex h-[350px]">
                {/* Map Placeholder */}
                <div className="w-2/3 border-r border-border relative bg-muted/20 flex items-center justify-center overflow-hidden">
                   {/* Abstract SVG Map Background */}
                   <svg viewBox="0 0 800 400" className="w-full h-full opacity-30 text-muted-foreground fill-current">
                     <path d="M150,100 Q180,90 200,120 T250,150 T300,100 T350,140 T400,90 T450,130 T500,80 T550,120 T600,70 T650,110 T700,60 L700,300 L150,300 Z" />
                   </svg>
                   
                   {/* Fake Markers */}
                   <div className="absolute top-1/3 left-1/2 w-6 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs shadow-lg transform -translate-x-1/2 -translate-y-1/2 border-2 border-background">2</div>
                   <div className="absolute top-1/2 left-2/3 w-6 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs shadow-lg transform -translate-x-1/2 -translate-y-1/2 border-2 border-background">1</div>
                   <div className="absolute top-2/3 left-3/4 w-6 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs shadow-lg transform -translate-x-1/2 -translate-y-1/2 border-2 border-background">1</div>
                   
                   <div className="absolute bottom-4 left-4 flex items-center text-xs text-muted-foreground space-x-2">
                     <span>Low</span>
                     <div className="w-20 h-1 bg-gradient-to-r from-gray-300 to-green-500 rounded"></div>
                     <span>High</span>
                   </div>
                </div>
                
                {/* Map Stats Table */}
                <div className="w-1/3 p-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground text-left border-b border-border">
                        <th className="pb-2 font-normal">Attack IP</th>
                        <th className="pb-2 font-normal">Attack times</th>
                        <th className="pb-2 font-normal">IP attribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mapStats.map((stat, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="py-3 text-blue-500">{stat.ip}</td>
                          <td className="py-3">{stat.times}</td>
                          <td className="py-3">{stat.country}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Top 10 IP & Pages */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="shadow-sm">
                <CardHeader className="p-4 pb-2 border-b flex flex-row items-center justify-between">
                  <CardTitle className="text-sm text-foreground flex items-center">
                    <Activity className="w-4 h-4 mr-2 text-orange-400" /> Traffic ranking TOP10
                  </CardTitle>
                  <a href="#" className="text-xs text-blue-500 hover:underline">More&gt;&gt;</a>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {topIps.map((ip, i) => (
                    <div key={i} className="flex items-center text-xs">
                      <div className={`w-5 h-5 rounded-full text-white flex items-center justify-center mr-3 flex-shrink-0 ${i < 3 ? 'bg-cyan-400' : 'bg-cyan-200'}`}>
                        {i + 1}
                      </div>
                      <div className="w-28 truncate text-foreground">{ip.ip}</div>
                      <div className="flex-1 mx-2">
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-cyan-400 transition-all" style={{ width: `${ip.percentage}%` }}></div>
                        </div>
                      </div>
                      <div className="text-muted-foreground w-8 text-right">{ip.count}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="p-4 pb-2 border-b flex flex-row items-center justify-between">
                  <CardTitle className="text-sm text-foreground flex items-center">
                    <Activity className="w-4 h-4 mr-2 text-orange-400" /> Visited pages TOP10
                  </CardTitle>
                  <a href="#" className="text-xs text-blue-500 hover:underline">More&gt;&gt;</a>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {topPages.map((page, i) => (
                    <div key={i} className="flex items-center text-xs">
                      <div className={`w-5 h-5 rounded-full text-white flex items-center justify-center mr-3 flex-shrink-0 ${i < 3 ? 'bg-emerald-500' : 'bg-emerald-300'}`}>
                        {i + 1}
                      </div>
                      <div className="w-36 truncate text-foreground" title={page.page}>{page.page}</div>
                      <div className="flex-1 mx-2">
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${page.percentage}%` }}></div>
                        </div>
                      </div>
                      <div className="text-muted-foreground w-8 text-right">{page.count}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

          </div>

          {/* BOTTOM FULL WIDTH - Latest block events */}
          <div className="col-span-12">
            <Card className="shadow-sm">
              <CardHeader className="p-4 pb-2 border-b">
                <CardTitle className="text-sm text-foreground flex items-center">
                  <ShieldAlert className="w-4 h-4 mr-2" /> Latest block events
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-muted-foreground text-left border-b border-border">
                      <th className="p-4 font-normal">Time</th>
                      <th className="p-4 font-normal">IP address</th>
                      <th className="p-4 font-normal">Domain</th>
                      <th className="p-4 font-normal">Attack type</th>
                      <th className="p-4 font-normal">URL</th>
                      <th className="p-4 font-normal text-right">Operate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestBlocks.map((block, i) => (
                      <tr key={i} className="border-b border-border hover:bg-muted/30">
                        <td className="p-4 text-muted-foreground">{block.time}</td>
                        <td className="p-4">{block.ip}</td>
                        <td className="p-4 text-muted-foreground">{block.domain}</td>
                        <td className="p-4 text-foreground">{block.type}</td>
                        <td className="p-4 text-muted-foreground truncate max-w-[200px]" title={block.url}>{block.url}</td>
                        <td className="p-4 text-right space-x-2">
                          <button className="text-blue-500 hover:underline text-xs">Block IP</button>
                          <button className="text-blue-500 hover:underline text-xs">White URL</button>
                          <button className="text-muted-foreground hover:text-foreground text-xs">Details</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}