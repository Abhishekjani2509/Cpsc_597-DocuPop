"use client";

import { useEffect, useState } from "react";
import { apiService, ProcessingJob, DataTable, DataRow } from "@/lib/api";
import { Card } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { Activity, Layers, AlertCircle, Database, TrendingUp } from "lucide-react";

const COLORS = { green: "#10b981", amber: "#f59e0b", red: "#ef4444", blue: "#3b82f6", gray: "#9ca3af" };

interface Props {
  jobs: ProcessingJob[];
  tables: DataTable[];
  allRows: DataRow[];
}

export default function DashboardCharts({ jobs, tables, allRows }: Props) {
  const [tableRows, setTableRows] = useState<Record<string, DataRow[]>>({});

  useEffect(() => {
    if (tables.length === 0) return;
    Promise.all(tables.map(t => apiService.listDataRows(t.id).then(rows => ({ id: t.id, rows }))))
      .then(results => {
        const map: Record<string, DataRow[]> = {};
        results.forEach(r => { map[r.id] = r.rows; });
        setTableRows(map);
      }).catch(() => {});
  }, [tables]);

  // Confidence distribution
  const confBuckets = { "≥90%": 0, "70–89%": 0, "<70%": 0, "No score": 0 };
  allRows.forEach(row => Object.values(row.data).forEach(cell => {
    if (cell && typeof cell === "object" && "confidence" in cell) {
      const c = cell.confidence as number | null;
      if (typeof c !== "number") confBuckets["No score"]++;
      else if (c >= 0.9) confBuckets["≥90%"]++;
      else if (c >= 0.7) confBuckets["70–89%"]++;
      else confBuckets["<70%"]++;
    }
  }));
  const confData = [
    { name: "≥90%",     value: confBuckets["≥90%"],     color: COLORS.green },
    { name: "70–89%",   value: confBuckets["70–89%"],   color: COLORS.amber },
    { name: "<70%",     value: confBuckets["<70%"],      color: COLORS.red },
    { name: "No score", value: confBuckets["No score"],  color: COLORS.gray },
  ].filter(d => d.value > 0);

  // Status breakdown
  const completed = jobs.filter(j => j.status === "completed").length;
  const failed    = jobs.filter(j => j.status === "failed").length;
  const pending   = jobs.filter(j => j.status === "pending" || j.status === "processing").length;
  const statusData = [
    { name: "Completed", value: completed, color: COLORS.green },
    { name: "Failed",    value: failed,    color: COLORS.red },
    { name: "Pending",   value: pending,   color: COLORS.amber },
  ].filter(d => d.value > 0);

  // Jobs over 14 days
  const dayMap: Record<string, number> = {};
  const now = Date.now();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    dayMap[d.toLocaleDateString("en-US", { month: "short", day: "numeric" })] = 0;
  }
  jobs.forEach(j => {
    const d = new Date(j.created_at);
    if (now - d.getTime() < 14 * 86400000) {
      const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (key in dayMap) dayMap[key]++;
    }
  });
  const timelineData = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

  // Adapter vs no-adapter
  const adapterJobs   = jobs.filter(j => j.status === "completed" && j.result?.metadata?.used_adapter && typeof j.confidence === "number");
  const noAdapterJobs = jobs.filter(j => j.status === "completed" && !j.result?.metadata?.used_adapter && typeof j.confidence === "number");
  const avgOf = (arr: ProcessingJob[]) => arr.length ? arr.reduce((s, j) => s + (j.confidence as number), 0) / arr.length * 100 : 0;
  const adapterCompData = [
    { name: "With Adapter", confidence: parseFloat(avgOf(adapterJobs).toFixed(1)),   fill: COLORS.blue },
    { name: "No Adapter",   confidence: parseFloat(avgOf(noAdapterJobs).toFixed(1)), fill: COLORS.gray },
  ];

  // Per-table confidence
  const tableConfData = tables.map(t => {
    const rows = tableRows[t.id] || [];
    const vals: number[] = [];
    rows.forEach(row => Object.values(row.data).forEach(cell => {
      if (cell && typeof cell === "object" && "confidence" in cell && typeof cell.confidence === "number") vals.push(cell.confidence);
    }));
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) : 0;
    return { name: t.name.length > 12 ? t.name.slice(0, 12) + "…" : t.name, confidence: avg, rows: rows.length };
  });

  return (
    <div className="space-y-6">
      {/* Timeline + Status */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><Activity className="h-4 w-4" />Jobs Over Last 14 Days</h2>
          {timelineData.some(d => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={2} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke={COLORS.blue} strokeWidth={2} dot={{ r: 3 }} name="Jobs" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">No jobs in the last 14 days</div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><Layers className="h-4 w-4" />Job Status</h2>
          {statusData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                    {statusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 justify-center mt-2">
                {statusData.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                    <span className="text-gray-600">{d.name} ({d.value})</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-gray-400 text-sm">No jobs yet</div>
          )}
        </Card>
      </div>

      {/* Adapter impact */}
      {(adapterJobs.length > 0 || noAdapterJobs.length > 0) && (
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2"><TrendingUp className="h-4 w-4" />Adapter Impact on Confidence</h2>
          <p className="text-xs text-gray-400 mb-4">Average confidence — jobs with a custom adapter vs without</p>
          <div className="flex items-end gap-6">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={adapterCompData} barSize={60}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v: number) => [`${v}%`, "Avg Confidence"]} />
                <Bar dataKey="confidence" radius={[6, 6, 0, 0]}>
                  {adapterCompData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="shrink-0 space-y-3 pr-4 pb-2">
              <div className="text-center">
                <p className="text-3xl font-bold text-blue-600">{avgOf(adapterJobs).toFixed(1)}%</p>
                <p className="text-xs text-gray-500 mt-0.5">With Adapter</p>
                <p className="text-xs text-gray-400">{adapterJobs.length} job{adapterJobs.length !== 1 ? "s" : ""}</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-gray-400">{avgOf(noAdapterJobs).toFixed(1)}%</p>
                <p className="text-xs text-gray-500 mt-0.5">No Adapter</p>
                <p className="text-xs text-gray-400">{noAdapterJobs.length} job{noAdapterJobs.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Confidence distribution + per-table */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><AlertCircle className="h-4 w-4" />Field Confidence Distribution</h2>
          {confData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={confData} barSize={36}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" name="Fields" radius={[4, 4, 0, 0]}>
                    {confData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 justify-center mt-2">
                {confData.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                    <span className="text-gray-600">{d.name}: {d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-gray-400 text-sm">No extracted data yet</div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><Database className="h-4 w-4" />Avg Confidence by Table</h2>
          {tableConfData.length > 0 && tableConfData.some(d => d.rows > 0) ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={tableConfData} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v: number) => [`${v}%`, "Avg Confidence"]} />
                <Bar dataKey="confidence" name="Confidence" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-gray-400 text-sm">
              {tables.length === 0 ? "No tables yet" : "No OCR data in tables yet"}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
