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
import { ShieldAlert, Activity, Globe, HardDrive, Filter, Clock, RefreshCw, CalendarIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export default function AdminWaf() {
  const [dateFilter, setDateFilter] = useState("Today");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { token } = useAuth();

  const fetchStats = async () => {
    try {
      setLoading(true);
      
      // Build query parameters based on date filter
      const params = new URLSearchParams();
      params.append('dateFilter', dateFilter);
      
      if (dateFilter === 'Select Date' && dateRange?.from && dateRange?.to) {
        // Add 1 day to the end date to include the full end day in ISO string formatting if timezone causes offset
        const startStr = format(dateRange.from, 'yyyy-MM-dd');
        const endStr = format(dateRange.to, 'yyyy-MM-dd');
        params.append('startDate', startStr);
        params.append('endDate', endStr);
      }

      console.log('[AdminWaf] Fetching stats from:', `${API_URL}/system/waf/stats?${params.toString()}`);
      const res = await fetch(`${API_URL}/system/waf/stats?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = await res.json();
      console.log('[AdminWaf] Received stats data:', data);
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
  }, [dateFilter, dateRange]);

  const totalBlocks = stats?.totalBlocksToday || 0;
  const totalBlocksYesterday = stats?.totalBlocksYesterday || 0;
  
  // Calculate percentage change
  let percentageChange = 0;
  if (totalBlocksYesterday > 0) {
    percentageChange = ((totalBlocks - totalBlocksYesterday) / totalBlocksYesterday) * 100;
  } else if (totalBlocks > 0) {
    percentageChange = 100;
  }
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

  const topUrls = stats?.topUrls?.map((u: any) => ({
    page: u.url,
    count: u.count,
    percentage: Math.min((u.count / (stats.topUrls[0]?.count || 1)) * 100, 100)
  })) || [];

  const latestBlocks = stats?.latestEvents?.map((e: any) => ({
    time: new Date(e.timestamp).toLocaleString(),
    ip: e.ip_address,
    domain: e.domain,
    type: e.attack_type,
    url: e.url
  })) || [];

  // Data for main chart
  let timeData = stats?.timeSeriesData || [];
  
  // If there's no real data, fallback to generating empty/mock layout with 24 hours so chart doesn't break
  if (timeData.length === 0) {
    timeData = Array.from({ length: 24 }).map((_, i) => ({
      time: `${String(i).padStart(2, '0')}:00`,
      total: 0,
      afterFilter: 0,
    }));
  }

  const miniChartData = Array.from({ length: 10 }).map((_, i) => ({
    time: `11:08:${i * 5}`,
    value: Math.floor(Math.random() * 15) + 2,
  }));

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1600px] mx-auto pb-10">
        
        {/* Header / Date Filter */}
        <div className="flex justify-between items-center bg-card text-card-foreground p-2 rounded-lg border shadow-sm">
          <div className="flex space-x-1 items-center">
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
            <div className="relative flex items-center group">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={dateFilter === "Select Date" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setDateFilter("Select Date")}
                    className={`ml-4 ${dateFilter === "Select Date" ? "bg-blue-500 hover:bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "LLL dd, y")} -{" "}
                          {format(dateRange.to, "LLL dd, y")}
                        </>
                      ) : (
                        format(dateRange.from, "LLL dd, y")
                      )
                    ) : (
                      <span>Select Date</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={(range) => {
                      setDateRange(range);
                      setDateFilter("Select Date");
                    }}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="flex items-center text-blue-500 font-medium">
            <Clock className="w-4 h-4 mr-2" />
            0
          </div>
        </div>

        <div className="space-y-4">
          
          {/* TOP ROW: Overview & Chart */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="col-span-1 h-[250px] flex gap-4">
              <Card className="shadow-sm border-t-4 border-t-blue-500 relative overflow-hidden flex-1">
                <CardContent className="p-4 flex flex-col justify-center h-full">
                  <div className="flex items-center space-x-2 text-blue-500 mb-2">
                    <div className="w-1 h-4 bg-blue-500 rounded"></div>
                    <span className="font-semibold text-sm">Request</span>
                  </div>
                  <div className="text-3xl font-bold mb-1">
                    {totalBlocks > 0 ? (totalBlocks * 153).toLocaleString() : '0'}
                  </div>
                  <div className={`text-xs flex items-center ${percentageChange >= 0 ? 'text-blue-500' : 'text-blue-400'}`}>
                    {percentageChange >= 0 ? '↑' : '↓'} {Math.abs(percentageChange).toFixed(2)}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center">
                    Yesterday: {(totalBlocksYesterday * 153).toLocaleString()}
                  </div>
                  <Activity className="absolute right-[-10px] bottom-[-10px] w-20 h-20 text-muted-foreground opacity-10" />
                </CardContent>
              </Card>

              <Card className="shadow-sm border-t-4 border-t-red-500 relative overflow-hidden flex-1">
                <CardContent className="p-4 flex flex-col justify-center h-full">
                  <div className="flex items-center space-x-2 text-red-500 mb-2">
                    <div className="w-1 h-4 bg-red-500 rounded"></div>
                    <span className="font-semibold text-sm">Malicious request</span>
                  </div>
                  <div className="text-3xl font-bold mb-1">{totalBlocks}</div>
                  <div className={`text-xs flex items-center ${percentageChange >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {percentageChange >= 0 ? '↑' : '↓'} {Math.abs(percentageChange).toFixed(2)}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center">
                    Yesterday: {totalBlocksYesterday}
                  </div>
                  <ShieldAlert className="absolute right-[-10px] bottom-[-10px] w-20 h-20 text-muted-foreground opacity-10" />
                </CardContent>
              </Card>
            </div>
            <div className="col-span-1 md:col-span-2">
              <Card className="shadow-sm h-[250px] flex flex-col">
                <CardHeader className="p-4 pb-0 border-b flex flex-row items-center justify-between">
                  <CardTitle className="text-sm text-foreground flex items-center">
                    <Filter className="w-4 h-4 mr-2" /> Traffic filtering request chart
                  </CardTitle>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchStats}>
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </CardHeader>
                <CardContent className="p-4 flex-1 flex flex-col">
                  <div className="flex justify-center space-x-6 mb-4 text-xs">
                    <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-green-500 mr-2"></div>Total requests</div>
                    <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-blue-400 mr-2"></div>After filtering</div>
                  </div>
                  <div className="flex-1 w-full min-h-0">
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
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* MIDDLE ROW: Top 10 Domains, IPs, Pages */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                {topUrls.map((page: any, i: number) => (
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

          {/* BOTTOM ROW: Block Type Pie & Latest Events */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="col-span-1">
              <Card className="shadow-sm h-full flex flex-col">
                <CardHeader className="p-4 pb-2 border-b">
                  <CardTitle className="text-sm text-foreground flex items-center">
                    <ShieldAlert className="w-4 h-4 mr-2" /> Block type
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 flex-1 flex flex-col justify-center">
                  <div className="w-full h-48 relative mb-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          innerRadius={60}
                          outerRadius={80}
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
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                      <span className="text-xs text-muted-foreground">Today's</span>
                      <span className="text-2xl font-bold">{totalBlocks}</span>
                    </div>
                  </div>
                  <div className="w-full space-y-3 overflow-y-auto max-h-32">
                    {pieData.map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-xs text-foreground">
                        <div className="flex items-center truncate">
                          <div className="w-3 h-3 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: d.color }}></div>
                          <span className="truncate">{d.name}</span>
                        </div>
                        <span className="font-medium ml-2">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="col-span-1 md:col-span-2">
              <Card className="shadow-sm h-full">
                <CardHeader className="p-4 pb-2 border-b">
                  <CardTitle className="text-sm text-foreground flex items-center">
                    <ShieldAlert className="w-4 h-4 mr-2" /> Latest block events
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-muted-foreground text-left border-b border-border">
                        <th className="p-4 font-normal">Time</th>
                        <th className="p-4 font-normal">IP address</th>
                        <th className="p-4 font-normal">Domain</th>
                        <th className="p-4 font-normal">Attack type</th>
                        <th className="p-4 font-normal">URL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestBlocks.map((block, i) => (
                        <tr key={i} className="border-b border-border hover:bg-muted/30">
                          <td className="p-4 text-muted-foreground whitespace-nowrap">{block.time}</td>
                          <td className="p-4 font-medium">{block.ip}</td>
                          <td className="p-4 text-muted-foreground truncate max-w-[150px]" title={block.domain}>{block.domain}</td>
                          <td className="p-4 font-semibold text-foreground whitespace-nowrap">{block.type}</td>
                          <td className="p-4 text-muted-foreground truncate max-w-[200px]" title={block.url}>{block.url}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}