"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiService, ProcessingJob, DataTable, DataRow } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { FileText, CheckCircle2, TrendingUp, Database, Clock } from "lucide-react";
import dynamic from "next/dynamic";

// Dynamically import the charts component — prevents recharts from running during SSR
const DashboardCharts = dynamic(() => import("./DashboardCharts"), { ssr: false, loading: () => (
  <div className="grid gap-4 md:grid-cols-2">
    {[...Array(4)].map((_, i) => <Card key={i} className="p-6 h-64 animate-pulse bg-gray-100" />)}
  </div>
)});

function StatCard({ icon, label, value, sub, color = "blue" }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string }) {
  const bg: Record<string, string> = { blue: "bg-blue-50 text-blue-600", green: "bg-green-50 text-green-600", amber: "bg-amber-50 text-amber-600", red: "bg-red-50 text-red-600" };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bg[color]}`}>{icon}</div>
        <div>
          <p className="text-xs text-gray-500 font-medium">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [tables, setTables] = useState<DataTable[]>([]);
  const [allRows, setAllRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [j, t] = await Promise.all([
        apiService.listProcessingJobs(),
        apiService.listDataTables(),
      ]);
      setJobs(j);
      setTables(t);
      const rowArrays = await Promise.all(t.map(tbl => apiService.listDataRows(tbl.id)));
      setAllRows(rowArrays.flat());
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  if (!user) return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <p className="text-gray-500">Sign in to view dashboard.</p>
    </div>
  );

  if (loading) return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-4">
        {[...Array(4)].map((_, i) => <Card key={i} className="p-5 h-24 animate-pulse bg-gray-100" />)}
      </div>
    </div>
  );

  const completed = jobs.filter(j => j.status === "completed").length;
  const failed    = jobs.filter(j => j.status === "failed").length;
  const successRate = jobs.length ? Math.round((completed / jobs.length) * 100) : 0;

  const avgConfidence = (() => {
    const vals: number[] = [];
    allRows.forEach(row => Object.values(row.data).forEach(cell => {
      if (cell && typeof cell === "object" && "confidence" in cell && typeof cell.confidence === "number") vals.push(cell.confidence);
    }));
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length * 100).toFixed(1) : "—";
  })();

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-gray-500">Overview of your document processing activity</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<FileText className="h-5 w-5" />} label="Total Jobs" value={jobs.length} sub={`${completed} completed`} color="blue" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Success Rate" value={`${successRate}%`} sub={`${failed} failed`} color="green" />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} label="Avg Confidence" value={avgConfidence === "—" ? "—" : `${avgConfidence}%`} sub="across all fields" color="amber" />
        <StatCard icon={<Database className="h-5 w-5" />} label="Data Tables" value={tables.length} sub={`${allRows.length} total rows`} color="blue" />
      </div>

      {/* Charts — dynamically imported, no SSR */}
      <DashboardCharts jobs={jobs} tables={tables} allRows={allRows} />

      {/* Recent jobs */}
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><Clock className="h-4 w-4" />Recent Jobs</h2>
        {jobs.length === 0 ? <p className="text-sm text-gray-400">No jobs yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500 font-medium">
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Engine</th>
                  <th className="pb-2 pr-4">Target Table</th>
                  <th className="pb-2 pr-4">Confidence</th>
                  <th className="pb-2">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.slice(0, 10).map(job => {
                  const sc: Record<string, string> = { completed: "text-green-600 bg-green-50", failed: "text-red-600 bg-red-50", pending: "text-amber-600 bg-amber-50", processing: "text-blue-600 bg-blue-50" };
                  return (
                    <tr key={job.id}>
                      <td className="py-2 pr-4"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sc[job.status] || "text-gray-600 bg-gray-100"}`}>{job.status}</span></td>
                      <td className="py-2 pr-4 text-gray-600">{job.engine}</td>
                      <td className="py-2 pr-4 text-gray-600">{job.target_table?.name || "—"}</td>
                      <td className="py-2 pr-4 font-medium text-gray-800">{typeof job.confidence === "number" ? `${(job.confidence * 100).toFixed(0)}%` : "—"}</td>
                      <td className="py-2 text-gray-400">{new Date(job.created_at).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
