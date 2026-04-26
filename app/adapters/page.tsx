"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { apiService, TextractAdapter } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { Cpu, Plus, Trash2, RefreshCw, CheckCircle, Clock, XCircle, ChevronDown, ChevronUp } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  ACTIVE:   { label: "Active",   icon: <CheckCircle className="h-3.5 w-3.5" />, className: "bg-green-100 text-green-700" },
  TRAINING: { label: "Training", icon: <Clock       className="h-3.5 w-3.5 animate-spin" />, className: "bg-yellow-100 text-yellow-700" },
  FAILED:   { label: "Failed",   icon: <XCircle     className="h-3.5 w-3.5" />, className: "bg-red-100 text-red-700" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, icon: null, className: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

interface CreateForm {
  name: string;
  description: string;
  featureTypes: string[];
}

export default function AdaptersPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [adapters, setAdapters] = useState<TextractAdapter[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateForm>({ name: "", description: "", featureTypes: ["QUERIES"] });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAdapters = useCallback(async () => {
    try {
      const data = await apiService.listTextractAdapters();
      setAdapters(data);
      return data;
    } catch (err) {
      console.error("Failed to load adapters:", err);
      return [];
    } finally {
      setPageLoading(false);
    }
  }, []);

  // Auto-poll while any version is TRAINING
  const startPollingIfNeeded = useCallback((data: TextractAdapter[]) => {
    const hasTraining = data.some(a => a.versions.some(v => v.status === "TRAINING"));
    if (hasTraining && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const updated = await loadAdapters();
        const stillTraining = updated.some(a => a.versions.some(v => v.status === "TRAINING"));
        if (!stillTraining && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 10000);
    }
  }, [loadAdapters]);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.push("/"); return; }
    loadAdapters().then(startPollingIfNeeded);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loading, user, router, loadAdapters, startPollingIfNeeded]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    if (form.featureTypes.length === 0) { toast.error("Select at least one feature type"); return; }
    setCreating(true);
    try {
      const adapter = await apiService.createTextractAdapter({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        featureTypes: form.featureTypes,
      });
      setAdapters(prev => [adapter, ...prev]);
      setShowCreate(false);
      setForm({ name: "", description: "", featureTypes: ["TABLES"] });
      toast.success("Adapter created", `"${adapter.name}" is ready. Add training data to create a version.`);
    } catch (err: any) {
      toast.error("Failed to create adapter", err?.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (adapter: TextractAdapter) => {
    if (!window.confirm(`Delete adapter "${adapter.name}" and all its versions? This cannot be undone.`)) return;
    setDeletingId(adapter.id);
    try {
      await apiService.deleteTextractAdapter(adapter.id);
      setAdapters(prev => prev.filter(a => a.id !== adapter.id));
      toast.success("Adapter deleted");
    } catch (err: any) {
      toast.error("Failed to delete adapter", err?.message);
    } finally {
      setDeletingId(null);
    }
  };

  const toggleExpand = (id: string) => setExpandedId(prev => prev === id ? null : id);

  if (pageLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-4xl px-6 py-12">
          <Skeleton className="h-10 w-64 mb-2" />
          <Skeleton className="h-6 w-96 mb-8" />
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const activeCount = adapters.filter(a => a.versions.some(v => v.status === "ACTIVE")).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-6 py-12 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Custom Adapters</h1>
            <p className="text-gray-600 mt-1">
              Manage Textract adapters for specialised document recognition.
              {adapters.length > 0 && (
                <span className="ml-2 text-sm text-gray-500">
                  {adapters.length} adapter{adapters.length !== 1 ? "s" : ""} · {activeCount} active
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => loadAdapters()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreate(v => !v)}>
              <Plus className="h-4 w-4 mr-1" /> New Adapter
            </Button>
          </div>
        </div>

        {/* Create Form */}
        {showCreate && (
          <Card className="border-blue-200 bg-blue-50/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Create New Adapter</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Invoice Extractor"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <input
                      type="text"
                      value={form.description}
                      onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                      placeholder="Optional description"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Feature Type</label>
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-md w-fit">
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">QUERIES</span>
                    <span className="text-xs text-gray-500">Textract adapters use query-based extraction</span>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button type="submit" size="sm" disabled={creating}>
                    {creating ? "Creating…" : "Create Adapter"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowCreate(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Adapter List */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-5 w-5 text-gray-600" />
              Your Adapters
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {adapters.length === 0 ? (
              <EmptyState
                icon={Cpu}
                title="No adapters yet"
                description="Create a custom adapter to improve extraction accuracy for specific document types."
              />
            ) : (
              <div className="space-y-3">
                {adapters.map(adapter => {
                  const isExpanded = expandedId === adapter.id;
                  const latestVersion = adapter.versions[0];
                  const overallStatus = latestVersion?.status ?? "NO_VERSIONS";

                  return (
                    <div key={adapter.id} className="border rounded-lg bg-white hover:shadow-sm transition-shadow">
                      {/* Adapter Header Row */}
                      <div className="flex items-center justify-between p-4 gap-4">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Cpu className="h-9 w-9 text-blue-500 flex-shrink-0 p-1.5 bg-blue-50 rounded-lg" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-gray-900 truncate">{adapter.name}</h3>
                              {latestVersion && <StatusBadge status={overallStatus} />}
                            </div>
                            {adapter.description && (
                              <p className="text-sm text-gray-500 truncate mt-0.5">{adapter.description}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              <span className="text-xs text-gray-400 font-mono">{adapter.id}</span>
                              <div className="flex gap-1">
                                {adapter.featureTypes.map(ft => (
                                  <span key={ft} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{ft}</span>
                                ))}
                              </div>
                              <span className="text-xs text-gray-400">
                                {adapter.versions.length} version{adapter.versions.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {adapter.versions.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggleExpand(adapter.id)}
                              title={isExpanded ? "Hide versions" : "Show versions"}
                            >
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDelete(adapter)}
                            disabled={deletingId === adapter.id}
                            title="Delete adapter"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Versions Panel */}
                      {isExpanded && adapter.versions.length > 0 && (
                        <div className="border-t bg-gray-50 px-4 py-3">
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Versions</p>
                          <div className="space-y-2">
                            {adapter.versions.map(v => (
                              <div key={v.version} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-3">
                                  <span className="font-mono text-gray-700">v{v.version}</span>
                                  <StatusBadge status={v.status} />
                                </div>
                                {v.createdAt && (
                                  <span className="text-xs text-gray-400">
                                    {new Date(v.createdAt).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* No-versions hint */}
                      {adapter.versions.length === 0 && (
                        <div className="border-t px-4 py-3 bg-amber-50">
                          <p className="text-xs text-amber-700">
                            No versions yet — upload training data via the AWS Textract console to create a trained version, then use this adapter ID <span className="font-mono">{adapter.id}</span> in Processing.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Box */}
        <Card className="border-gray-200 bg-gray-50">
          <CardContent className="pt-5 pb-4">
            <p className="text-sm font-medium text-gray-700 mb-1">How to train an adapter</p>
            <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
              <li>Create the adapter here — it gets an ID immediately.</li>
              <li>Open the AWS Textract console → Custom adapters → select your adapter.</li>
              <li>Upload ground truth documents (PDF/images + Textract JSON labels) and start a training job.</li>
              <li>Once status shows <span className="font-medium text-green-700">Active</span>, select it from the adapter dropdown in Processing.</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
