"use client";

const TABLE_TEMPLATES: Record<string, string[]> = {
  Invoices: ["DocumentName", "InvoiceNumber", "Name", "Company", "Total", "AmountDue"],
  Expenses: ["DocumentName", "Vendor", "Category", "Amount", "Date"],
  Contacts: ["DocumentName", "Name", "Company", "Email", "Phone"],
};
const DOCUMENT_NAME_FIELD = "DocumentName";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiService, DataFieldMapping, DataRow, DataTable } from "@/lib/api";
import { AgGridReact } from "ag-grid-react";
import { ColDef, SelectionChangedEvent, CellValueChangedEvent, CheckboxSelectionCallbackParams, ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import { Download, Filter, ZoomIn, ZoomOut, Maximize2, LayoutGrid, Table2, ClipboardCheck, User, FileText, Heart, CheckCircle2, AlertCircle, Pencil, X, Check } from "lucide-react";
// LayoutGrid = cards view icon, Table2 = table view icon, ClipboardCheck = review icon
import { toast } from "@/components/ui/toast";

// ── Types ─────────────────────────────────────────────────────────────────────
type ViewMode = "table" | "cards" | "review";
type CardType = "employee" | "invoice" | "patient" | "generic";

function detectCardType(tableName: string): CardType {
  const n = tableName.toLowerCase();
  if (n.includes("emp")) return "employee";
  if (n.includes("inv")) return "invoice";
  if (n.includes("pat")) return "patient";
  return "generic";
}

const CARD_THEME: Record<CardType, { accent: string; light: string; icon: React.ReactNode; label: string }> = {
  employee: { accent: "border-blue-400",  light: "bg-blue-50",   icon: <User className="h-5 w-5 text-blue-500" />,   label: "Employee Record" },
  invoice:  { accent: "border-green-400", light: "bg-green-50",  icon: <FileText className="h-5 w-5 text-green-500" />, label: "Invoice" },
  patient:  { accent: "border-purple-400",light: "bg-purple-50", icon: <Heart className="h-5 w-5 text-purple-500" />, label: "Patient Record" },
  generic:  { accent: "border-gray-300",  light: "bg-gray-50",   icon: <FileText className="h-5 w-5 text-gray-400" />, label: "Document" },
};

function ConfidenceDot({ value }: { value: number | null }) {
  if (value === null) return <span className="w-2 h-2 rounded-full bg-gray-200 inline-block" />;
  if (value >= 0.9) return <span className="w-2 h-2 rounded-full bg-green-500 inline-block" title={`${(value*100).toFixed(0)}%`} />;
  if (value >= 0.7) return <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" title={`${(value*100).toFixed(0)}%`} />;
  return <span className="w-2 h-2 rounded-full bg-red-500 inline-block" title={`${(value*100).toFixed(0)}%`} />;
}

function confidenceColor(v: number | null) {
  if (v === null) return "text-gray-500";
  if (v >= 0.9) return "text-green-600";
  if (v >= 0.7) return "text-amber-500";
  return "text-red-500";
}

function rowNeedsReview(row: DataRow): boolean {
  return Object.values(row.data).some(cell => {
    if (cell && typeof cell === "object" && "confidence" in cell) {
      return typeof cell.confidence === "number" && cell.confidence < 0.8;
    }
    return false;
  });
}

function getDocName(row: DataRow): string {
  const cell = row.data[DOCUMENT_NAME_FIELD];
  if (!cell) return "Untitled";
  if (typeof cell === "object" && "value" in cell) return String(cell.value || "Untitled");
  return String(cell || "Untitled");
}

// ── Document Card ─────────────────────────────────────────────────────────────
function DocumentCard({
  row, table, cardType, isApproved, editingId, editValues,
  onApprove, onStartEdit, onSaveEdit, onCancelEdit, onEditChange,
}: {
  row: DataRow; table: DataTable; cardType: CardType; isApproved: boolean;
  editingId: string | null; editValues: Record<string, string>;
  onApprove: (id: string) => void; onStartEdit: (row: DataRow) => void;
  onSaveEdit: (id: string) => void; onCancelEdit: () => void;
  onEditChange: (field: string, val: string) => void;
}) {
  const theme = CARD_THEME[cardType];
  const isEditing = editingId === row.id;
  const docName = getDocName(row);
  const fields = table.fields.filter(f => f.name !== DOCUMENT_NAME_FIELD);
  const hasLowConf = rowNeedsReview(row) && !isApproved;

  return (
    <div className={`rounded-xl border-2 ${hasLowConf ? "border-amber-300" : isApproved ? "border-green-300" : theme.accent} bg-white shadow-sm hover:shadow-md transition-shadow`}>
      {/* Card header */}
      <div className={`flex items-center justify-between px-4 py-3 rounded-t-xl ${theme.light} border-b`}>
        <div className="flex items-center gap-2">
          {theme.icon}
          <div>
            <p className="text-xs font-medium text-gray-500">{theme.label}</p>
            <p className="text-sm font-semibold text-gray-800 truncate max-w-[180px]">{docName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isApproved && <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><CheckCircle2 className="h-3.5 w-3.5" />Approved</span>}
          {hasLowConf && <span className="flex items-center gap-1 text-xs text-amber-600 font-medium"><AlertCircle className="h-3.5 w-3.5" />Needs Review</span>}
        </div>
      </div>

      {/* Fields */}
      <div className="px-4 py-3 grid grid-cols-1 gap-1.5">
        {fields.map(f => {
          const cell = row.data[f.name];
          const val = cell && typeof cell === "object" && "value" in cell ? String(cell.value ?? "") : String(cell ?? "");
          const conf = cell && typeof cell === "object" && "confidence" in cell ? cell.confidence as number | null : null;
          const isLow = conf !== null && conf < 0.8;

          return (
            <div key={f.name} className={`flex items-center justify-between py-1 px-2 rounded ${isLow && !isApproved ? "bg-red-50" : "hover:bg-gray-50"}`}>
              <span className="text-xs font-medium text-gray-500 w-32 shrink-0">{f.name}</span>
              {isEditing ? (
                <input
                  className="flex-1 text-xs border border-blue-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={editValues[f.name] ?? val}
                  onChange={e => onEditChange(f.name, e.target.value)}
                />
              ) : (
                <span className={`flex-1 text-xs font-medium truncate ${isLow && !isApproved ? "text-red-700" : "text-gray-800"}`}>{val || <span className="text-gray-300 italic">—</span>}</span>
              )}
              <div className="flex items-center gap-1.5 ml-2">
                {conf !== null && <span className={`text-xs ${confidenceColor(conf)}`}>{(conf*100).toFixed(0)}%</span>}
                <ConfidenceDot value={conf} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 px-4 py-2 border-t bg-gray-50 rounded-b-xl">
        {isEditing ? (
          <>
            <Button size="sm" variant="outline" onClick={onCancelEdit} className="h-7 text-xs"><X className="h-3 w-3 mr-1" />Cancel</Button>
            <Button size="sm" onClick={() => onSaveEdit(row.id)} className="h-7 text-xs"><Check className="h-3 w-3 mr-1" />Save</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => onStartEdit(row)} className="h-7 text-xs"><Pencil className="h-3 w-3 mr-1" />Edit</Button>
            {!isApproved && <Button size="sm" onClick={() => onApprove(row.id)} className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"><CheckCircle2 className="h-3 w-3 mr-1" />Approve</Button>}
          </>
        )}
      </div>
    </div>
  );
}

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

export default function DataPage() {
  const { user } = useAuth();
  const [tables, setTables] = useState<DataTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<DataTable | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [tableForm, setTableForm] = useState({ name: "", description: "" });
  const [tableMappings, setTableMappings] = useState<DataFieldMapping[]>([]);
  const [mappingForm, setMappingForm] = useState({ sourceLabel: "", targetField: "", matcher: "contains" });
  const [newRowForm, setNewRowForm] = useState<Record<string, string>>({});
  const [showNewRowForm, setShowNewRowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [savingTable, setSavingTable] = useState(false);

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newFields, setNewFields] = useState("");
  const [newFieldName, setNewFieldName] = useState("");
  const [showFieldManager, setShowFieldManager] = useState(false);

  const [quickFilter, setQuickFilter] = useState("");
  const [gridHeight, setGridHeight] = useState(600);
  const [showConfidenceColumns, setShowConfidenceColumns] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const gridRef = useRef<AgGridReact>(null);

  // Cards / Review view state
  const [viewMode, setViewMode] = useState<"table" | "cards" | "review">("table");
  const [approvedIds, setApprovedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("docupop_approved_ids");
      return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const handleApprove = (id: string) => setApprovedIds(prev => {
    const next = new Set([...prev, id]);
    try { localStorage.setItem("docupop_approved_ids", JSON.stringify([...next])); } catch {}
    return next;
  });
  const handleStartEdit = (row: DataRow) => {
    const vals: Record<string, string> = {};
    if (selectedTable) {
      selectedTable.fields.filter(f => f.name !== DOCUMENT_NAME_FIELD).forEach(f => {
        const cell = row.data[f.name];
        vals[f.name] = cell && typeof cell === "object" && "value" in cell ? String(cell.value ?? "") : String(cell ?? "");
      });
    }
    setEditValues(vals);
    setEditingId(row.id);
  };
  const handleSaveEdit = async (id: string) => {
    if (!selectedTable) return;
    const row = rows.find(r => r.id === id);
    if (!row) return;
    const payload: Record<string, any> = {};
    selectedTable.fields.forEach(f => {
      const cell = row.data[f.name];
      const origConf = cell && typeof cell === "object" && "confidence" in cell ? (cell as any).confidence : null;
      payload[f.name] = { value: editValues[f.name] ?? (cell && typeof cell === "object" && "value" in cell ? cell.value : cell) ?? "", confidence: origConf };
    });
    try {
      await apiService.updateDataRow(selectedTable.id, id, payload);
      await loadRows(selectedTable.id);
      setApprovedIds(prev => {
        const next = new Set([...prev, id]);
        try { localStorage.setItem("docupop_approved_ids", JSON.stringify([...next])); } catch {}
        return next;
      });
    } catch { toast.error("Unable to save"); }
    setEditingId(null);
    setEditValues({});
  };
  const handleCancelEdit = () => { setEditingId(null); setEditValues({}); };
  const handleEditChange = (field: string, val: string) => setEditValues(prev => ({ ...prev, [field]: val }));

  const loadRows = useCallback(
    async (tableId: string) => {
      try {
        const data = await apiService.listDataRows(tableId);
        setRows(data);
      } catch (error) {
        console.error("Failed to load rows", error);
        setRows([]);
      } finally {
        setSelectedRowIds([]);
      }
    },
    []
  );

  const selectTableById = useCallback(
    async (tableId: string) => {
      try {
        // Clear current data first to prevent rendering errors
        setRows([]);
        setSelectedRowIds([]);
        setShowNewRowForm(false);
        setNewRowForm({});
        setQuickFilter("");

        const detail = await apiService.getDataTable(tableId);
        setSelectedTable(detail);
        setTableMappings(detail.mappings ?? []);
        await loadRows(tableId);
      } catch (error) {
        console.error("Failed to load table", error);
        toast.error("Failed to load table");
      }
    },
    [loadRows]
  );

  const loadTables = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await apiService.listDataTables();
      setTables(data);

      // Only auto-select if no table is currently selected
      if (!selectedTable && data.length) {
        await selectTableById(data[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [user, selectedTable, selectTableById]);

  useEffect(() => {
    if (!user) return;
    loadTables();
  }, [user, loadTables]);

  useEffect(() => {
    const calculateHeight = () => {
      const vh = window.innerHeight;
      setGridHeight(Math.max(400, Math.min(800, vh - 400)));
    };
    calculateHeight();
    window.addEventListener("resize", calculateHeight);
    return () => window.removeEventListener("resize", calculateHeight);
  }, []);

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 10, 150));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 10, 30));
  };

  const handleResetZoom = () => {
    setZoomLevel(100);
  };

  const handleFitAllColumns = () => {
    if (!gridRef.current) return;

    try {
      // Get all columns
      const allColumns = gridRef.current.api.getAllDisplayedColumns();
      if (!allColumns || allColumns.length === 0) return;

      // Calculate total width of all columns
      let totalWidth = 0;
      allColumns.forEach((col) => {
        totalWidth += col.getActualWidth();
      });

      // Get container width (approximate - using window width as reference)
      const containerWidth = window.innerWidth - 150; // Account for padding and margins

      // Calculate zoom level needed to fit all columns
      const neededZoom = Math.floor((containerWidth / totalWidth) * 100);

      // Set zoom level (minimum 30%, maximum 100%)
      const fitZoom = Math.max(30, Math.min(100, neededZoom));
      setZoomLevel(fitZoom);

      toast.success(`Zoom adjusted to ${fitZoom}% to fit all columns`);
    } catch (error) {
      console.error('Failed to fit columns:', error);
    }
  };


  useEffect(() => {
    if (selectedTable) {
      setTableForm({
        name: selectedTable.name,
        description: selectedTable.description || "",
      });
      if (selectedTable.fields.length) {
        setMappingForm((prev) => ({
          ...prev,
          targetField: prev.targetField || selectedTable.fields[0].name,
        }));
      }
    } else {
      setTableForm({ name: "", description: "" });
    }
  }, [selectedTable]);

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const fields = newFields
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean)
      .map((name) => ({ name }));

    setCreating(true);
    try {
      const table = await apiService.createDataTable({
        name: newName,
        description: newDescription,
        fields,
      });
      setNewName("");
      setNewDescription("");
      setNewFields("");
      setTables([table, ...tables]);
    } catch (error) {
      console.error("Create table error", error);
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (selectedTable) {
      setTableForm({
        name: selectedTable.name,
        description: selectedTable.description || "",
      });
      setSelectedRowIds([]);
    }
  }, [selectedTable]);

  const handleSelectTable = async (table: DataTable) => {
    await selectTableById(table.id);
  };

  const handleTableUpdate = async () => {
    if (!selectedTable) return;
    setSavingTable(true);
    try {
      const updated = await apiService.updateDataTable(selectedTable.id, {
        name: tableForm.name,
        description: tableForm.description,
      });
      setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setSelectedTable(updated);
    } catch (error) {
      console.error("Update table error", error);
      toast.error("Unable to update table");
    } finally {
      setSavingTable(false);
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    if (!window.confirm("Delete this table and all rows?")) return;
    try {
      await apiService.deleteDataTable(tableId);
      setTables((prev) => prev.filter((t) => t.id !== tableId));
      if (selectedTable?.id === tableId) {
        setSelectedTable(null);
        setRows([]);
        setTableMappings([]);
        setSelectedRowIds([]);
      }
    } catch (error) {
      console.error("Delete error", error);
    }
  };

  const handleCsvUpload = async (tableId: string, file: File | null) => {
    if (!file) return;
    setUploadingId(tableId);
    try {
      const result = await apiService.importCsv(tableId, file);
      // Reload tables to get any new fields created from CSV headers
      await loadTables();
      // Then reload rows for the current table
      await loadRows(tableId);
      toast.success(`Imported ${result} rows successfully`);
    } catch (error) {
      console.error("Import error", error);
      toast.error("Failed to import CSV. Please check the file format.");
    } finally {
      setUploadingId(null);
    }
  };

  const beginNewRow = () => {
    if (!selectedTable) return;
    const form: Record<string, string> = {};
    selectedTable.fields.forEach((field) => {
      form[fieldValueKey(field.name)] = "";
      form[fieldConfidenceKey(field.name)] = "";
    });
    setNewRowForm(form);
    setShowNewRowForm(true);
  };

  const handleCreateRow = async () => {
    if (!selectedTable) return;
    const payload: Record<string, any> = {};
    selectedTable.fields.forEach((field) => {
      payload[field.name] = {
        value: newRowForm[fieldValueKey(field.name)] ?? "",
        confidence: toDecimalConfidence(newRowForm[fieldConfidenceKey(field.name)]),
      };
    });
    if (!payload[DOCUMENT_NAME_FIELD]) {
      payload[DOCUMENT_NAME_FIELD] = {
        value: newRowForm[fieldValueKey(DOCUMENT_NAME_FIELD)] ?? "",
        confidence: toDecimalConfidence(newRowForm[fieldConfidenceKey(DOCUMENT_NAME_FIELD)]),
      };
    }
    try {
      await apiService.addDataRows(selectedTable.id, [payload]);
      await loadRows(selectedTable.id);
      setShowNewRowForm(false);
      setNewRowForm({});
      setSelectedRowIds([]);
    } catch (error) {
      console.error("Add row error", error);
      toast.error("Unable to add row");
    }
  };

  const handleDeleteRows = async () => {
    if (!selectedTable || selectedRowIds.length === 0) return;
    const count = selectedRowIds.length;
    if (!window.confirm(`Delete ${count} selected row${count > 1 ? "s" : ""}?`)) return;
    try {
      await Promise.all(selectedRowIds.map((rowId) => apiService.deleteDataRow(selectedTable.id, rowId)));
      await loadRows(selectedTable.id);
      setSelectedRowIds([]);
      toast.success(`Deleted ${count} row${count > 1 ? "s" : ""} successfully`);
    } catch (error) {
      console.error("Delete row error", error);
      toast.error("Unable to delete row(s)");
    }
  };

  const handleAddMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTable || !mappingForm.sourceLabel || !mappingForm.targetField) return;
    try {
      const mapping = await apiService.createFieldMapping(selectedTable.id, mappingForm);
      setTableMappings((prev) => [...prev, mapping]);
      setMappingForm((prev) => ({ ...prev, sourceLabel: "" }));
    } catch (error) {
      console.error("Add mapping error", error);
      toast.error("Unable to add mapping");
    }
  };

  const handleDeleteMapping = async (mappingId: string) => {
    if (!selectedTable) return;
    try {
      await apiService.deleteFieldMapping(selectedTable.id, mappingId);
      setTableMappings((prev) => prev.filter((m) => m.id !== mappingId));
      toast.success("Mapping deleted successfully");
    } catch (error) {
      console.error("Delete mapping error", error);
      toast.error("Unable to delete mapping");
    }
  };

  const applyTemplate = (fields: string[]) => {
    setNewFields(fields.join(", "));
  };

  const handleAddField = async () => {
    if (!selectedTable || !newFieldName.trim()) return;

    try {
      // Add the field as a new column using the dedicated endpoint
      await apiService.addField(selectedTable.id, newFieldName.trim());

      // Refresh the table to get the new field in the schema
      await selectTableById(selectedTable.id);

      setNewFieldName("");
      setShowFieldManager(false);
      toast.success(`Field "${newFieldName.trim()}" added successfully`);
    } catch (error: any) {
      console.error("Add field error", error);
      toast.error(error.message || "Unable to add field");
    }
  };

  const fieldValueKey = (name: string) => `${name}__value`;
  const fieldConfidenceKey = (name: string) => `${name}__confidence`;
  const toDecimalConfidence = (value: any): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const scaled = numeric > 1 ? numeric / 100 : numeric;
    if (scaled < 0) return 0;
    if (scaled > 1) return 1;
    return scaled;
  };

  const selectionColumn = useMemo<ColDef>(
    () => ({
      headerName: "",
      field: "__select__",
      width: 70,
      maxWidth: 70,
      pinned: "left",
      lockPinned: true,
      resizable: false,
      sortable: false,
      filter: false,
      floatingFilter: false,
      suppressMenu: true,
      checkboxSelection: (params: CheckboxSelectionCallbackParams) => params.node.rowPinned !== "top",
      headerCheckboxSelection: true,
      headerCheckboxSelectionFilteredOnly: true,
    }),
    []
  );

  // Cell renderer for value with confidence bar
  const ValueWithConfidenceBar = (props: any) => {
    const { value, data } = props;
    const field = props.colDef.field;
    const fieldName = field?.replace('__value', '');
    const confidenceField = `${fieldName}__confidence`;

    if (!value && value !== 0) return null;

    // If confidence columns are shown, just show the value
    if (showConfidenceColumns) {
      return <div>{value}</div>;
    }

    // Get confidence value
    const confidenceValue = parseFloat(data?.[confidenceField]);

    // If no confidence data, just show value
    if (isNaN(confidenceValue)) {
      return <div>{value}</div>;
    }

    // Determine color based on confidence threshold
    let barColor = '#ef4444'; // red for <70%
    if (confidenceValue >= 90) {
      barColor = '#10b981'; // green
    } else if (confidenceValue >= 70) {
      barColor = '#f59e0b'; // orange
    }

    return (
      <div style={{ padding: '4px 0' }}>
        <div style={{ marginBottom: '4px' }}>{value}</div>
        <div style={{ width: '100%', height: '4px', background: '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ width: `${confidenceValue}%`, height: '100%', background: barColor, transition: 'width 0.3s ease' }} />
        </div>
      </div>
    );
  };

  const columnDefs = useMemo<ColDef[]>(
    () => {
      if (!selectedTable) return [];

      const cols: ColDef[] = [selectionColumn];

      selectedTable.fields.forEach((field) => {
        const isDocumentName = field.name === DOCUMENT_NAME_FIELD;
        const confidenceField = fieldConfidenceKey(field.name);

        // Data value column with embedded confidence bar
        cols.push({
          headerName: field.name,
          field: fieldValueKey(field.name),
          flex: 1,
          minWidth: 160,
          editable: (params: any) =>
            params.node.rowPinned === "top" ? true : !isDocumentName,
          cellRenderer: ValueWithConfidenceBar,
          autoHeight: !showConfidenceColumns,
        });

        // Confidence column (can be toggled via button)
        cols.push({
          headerName: `${field.name} (Confidence)`,
          field: confidenceField,
          width: 140,
          editable: false,
          hide: !showConfidenceColumns,
          headerClass: 'ag-right-aligned-header',
          filter: 'agNumberColumnFilter',
          filterParams: {
            filterOptions: ['equals', 'notEqual', 'lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual', 'inRange'],
            defaultOption: 'greaterThanOrEqual',
          },
          cellStyle: (params: any) => {
            const val = parseFloat(params.value);
            if (isNaN(val)) return { textAlign: 'right' };
            if (val >= 90) return { color: "#10b981", fontWeight: 500, textAlign: 'right' };
            if (val >= 70) return { color: "#f59e0b", fontWeight: 500, textAlign: 'right' };
            return { color: "#ef4444", fontWeight: 500, textAlign: 'right' };
          },
        });
      });

      return cols;
    },
    [selectedTable, selectionColumn, showConfidenceColumns]
  );

  const rowData = useMemo(
    () =>
      selectedTable
        ? rows.map((row) => {
            const entry: Record<string, any> = { id: row.id };
            selectedTable.fields.forEach((field) => {
              const cell = row.data[field.name];
              if (cell && typeof cell === "object" && "value" in cell) {
                entry[fieldValueKey(field.name)] = cell.value ?? "";
                entry[fieldConfidenceKey(field.name)] =
                  typeof cell.confidence === "number"
                    ? (cell.confidence * 100).toFixed(1)
                    : cell?.confidence ?? "";
              } else {
                entry[fieldValueKey(field.name)] = cell ?? "";
                entry[fieldConfidenceKey(field.name)] = "";
              }
            });
            return entry;
          })
        : [],
    [rows, selectedTable]
  );

  const pinnedTopRowData = useMemo(() => {
    if (!showNewRowForm || !selectedTable) return [];
    return [
      {
        id: "__new__",
        ...newRowForm,
      },
    ];
  }, [showNewRowForm, newRowForm, selectedTable]);

  const handleCellValueChanged = async (event: CellValueChangedEvent) => {
    if (!selectedTable) return;
    const rowId = event.data?.id;
    if (!rowId) return;

    if (event.node.rowPinned === "top") {
      const fieldName = event.colDef.field;
      if (!fieldName || (!fieldName.endsWith("__value") && !fieldName.endsWith("__confidence"))) return;
      setNewRowForm((prev) => ({
        ...prev,
        [fieldName]: event.newValue ?? "",
      }));
      return;
    }

    const payload: Record<string, any> = {};
    selectedTable.fields.forEach((field) => {
      payload[field.name] = {
        value: event.data[fieldValueKey(field.name)],
        confidence: toDecimalConfidence(event.data[fieldConfidenceKey(field.name)]),
      };
    });

    try {
      await apiService.updateDataRow(selectedTable.id, rowId, payload);
      await loadRows(selectedTable.id);
    } catch (error) {
      console.error("Save row error", error);
      toast.error("Unable to save change");
      await loadRows(selectedTable.id);
    }
  };

  const handleSelectionChanged = (event: SelectionChangedEvent) => {
    const rows = event
      .api
      .getSelectedRows()
      .filter((row) => row?.id && row.id !== "__new__");
    setSelectedRowIds(rows.map((row) => row.id));
  };

  const handleExportCsv = () => {
    if (!gridRef.current || !selectedTable) return;
    gridRef.current.api.exportDataAsCsv({
      fileName: `${selectedTable.name}_${Date.now()}.csv`,
    });
    toast.success("CSV exported successfully");
  };

  if (!user) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <p className="text-gray-600 text-lg">Sign in to manage datasets.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Data Hub</h1>
        <p className="mt-2 text-gray-600">
          Define custom tables, upload CSVs, and prepare datasets for reconciliation against OCR output.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4 space-y-2">
          <Badge>Ground Truth</Badge>
          <p className="text-sm text-gray-600">
            Each table represents a trusted dataset that OCR output will be validated against.
          </p>
        </Card>
        <Card className="p-4 space-y-2">
          <Badge variant="secondary">Reconciliation</Badge>
          <p className="text-sm text-gray-600">
            Map OCR fields to table columns, track variances, and provide confidence scores.
          </p>
        </Card>
        <Card className="p-4 space-y-2">
          <Badge variant="secondary">Confidence</Badge>
          <p className="text-sm text-gray-600">
            Use these data sources to auto-approve high confidence matches and flag exceptions.
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 space-y-4">
          <h2 className="text-xl font-semibold text-gray-800">Create Table</h2>
          <form className="space-y-3" onSubmit={handleCreateTable}>
            <div>
              <label className="text-sm font-medium text-gray-600">Name</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Description</label>
              <Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Fields (comma-separated)</label>
              <Input
                placeholder="id, amount, description"
                value={newFields}
                onChange={(e) => setNewFields(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                DocumentName is automatically included. You can leave fields empty - uploading a CSV will automatically create columns from the CSV headers.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(TABLE_TEMPLATES).map(([label, fields]) => (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => applyTemplate(fields)}
                  >
                    Use {label}
                  </Button>
                ))}
              </div>
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create Table"}
            </Button>
          </form>
        </Card>

        <Card className="p-6 space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-800">Tables</h2>
            <Button variant="outline" size="sm" onClick={loadTables} disabled={loading}>
              Refresh
            </Button>
          </div>
          {tables.length === 0 ? (
            <p className="text-sm text-gray-500">No tables yet.</p>
          ) : (
            <div className="space-y-3">
              {tables.map((table) => (
                <div
                  key={table.id}
                  className={`rounded border p-4 cursor-pointer transition ${
                    selectedTable?.id === table.id ? "border-blue-500 bg-blue-50" : "border-gray-200"
                  }`}
                  onClick={() => handleSelectTable(table)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{table.name}</p>
                      <p className="text-xs text-gray-500">{table.fields.length} fields</p>
                    </div>
                    <div className="flex gap-2">
                      <label className="text-sm text-blue-600 hover:underline">
                        <input
                          type="file"
                          accept=".csv"
                          className="hidden"
                          onChange={(e) => handleCsvUpload(table.id, e.target.files?.[0] || null)}
                        />
                        {uploadingId === table.id ? "Uploading..." : "Upload CSV"}
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTable(table.id);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {table.fields.map((field) => (
                      <Badge key={field.id} variant="secondary">
                        {field.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {selectedTable && (
        <div className="space-y-6">
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Table Details</h2>
                <p className="text-sm text-gray-500">Update metadata or define reconciliation notes.</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleTableUpdate} disabled={savingTable}>
                {savingTable ? "Saving..." : "Save Changes"}
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-gray-600">Name</label>
                <Input value={tableForm.name} onChange={(e) => setTableForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Description</label>
                <Textarea
                  value={tableForm.description}
                  onChange={(e) => setTableForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Fields</h3>
                  <p className="text-sm text-gray-500">{selectedTable.fields.length} fields in this table</p>
                </div>
                <Button size="sm" onClick={() => setShowFieldManager(!showFieldManager)}>
                  {showFieldManager ? "Hide" : "Add Field"}
                </Button>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                {selectedTable.fields.map((field) => (
                  <Badge key={field.id} variant="secondary" className="text-sm py-1 px-3">
                    {field.name}
                  </Badge>
                ))}
              </div>

              {showFieldManager && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-600">New Field Name</label>
                    <Input
                      placeholder="e.g., CustomerEmail, TotalAmount"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddField();
                        }
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleAddField} disabled={!newFieldName.trim()}>
                      Add Field
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      setShowFieldManager(false);
                      setNewFieldName("");
                    }}>
                      Cancel
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    New fields will be added as columns. Data for existing rows will be empty for the new field.
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Field Mappings</h2>
                <p className="text-sm text-gray-500">
                  Map OCR labels (e.g. "Invoice #") to table columns for deterministic ingestion.
                </p>
              </div>
            </div>
            {tableMappings.length === 0 ? (
              <p className="text-sm text-gray-500">No mappings yet. Add one below.</p>
            ) : (
              <div className="space-y-2">
                {tableMappings.map((mapping) => (
                  <div key={mapping.id} className="flex items-center justify-between rounded border px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{mapping.source_label}</p>
                      <p className="text-xs text-gray-500">
                        -&gt; {mapping.target_field} ({mapping.matcher})
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteMapping(mapping.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <form className="space-y-3" onSubmit={handleAddMapping}>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-gray-600">Source Label</label>
                  <Input
                    placeholder="Invoice #"
                    value={mappingForm.sourceLabel}
                    onChange={(e) => setMappingForm((prev) => ({ ...prev, sourceLabel: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Target Field</label>
                  <select
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={mappingForm.targetField}
                    onChange={(e) => setMappingForm((prev) => ({ ...prev, targetField: e.target.value }))}
                  >
                    {selectedTable.fields.map((field) => (
                      <option key={field.id} value={field.name}>
                        {field.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm">
                  Add Mapping
                </Button>
              </div>
            </form>
          </Card>

          <Card className="p-6 space-y-4">
            {/* Header row */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">{selectedTable.name} Rows</h2>
                <p className="text-sm text-gray-500">{rows.length} total rows</p>
              </div>

              {/* View toggle */}
              <div className="flex items-center rounded-lg border bg-gray-50 p-1 gap-1">
                <button
                  onClick={() => setViewMode("table")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === "table" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
                >
                  <Table2 className="h-4 w-4" />Table
                </button>
                <button
                  onClick={() => setViewMode("cards")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === "cards" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
                >
                  <LayoutGrid className="h-4 w-4" />Cards
                </button>
                <button
                  onClick={() => setViewMode("review")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === "review" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
                >
                  <ClipboardCheck className="h-4 w-4" />Review
                  {rows.filter(r => rowNeedsReview(r) && !approvedIds.has(r.id)).length > 0 && (
                    <span className="ml-1 rounded-full bg-amber-500 text-white text-xs px-1.5 py-0.5 leading-none">
                      {rows.filter(r => rowNeedsReview(r) && !approvedIds.has(r.id)).length}
                    </span>
                  )}
                </button>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 flex-wrap">
                {viewMode === "table" && (
                  <>
                    <div className="flex items-center gap-1 border rounded-md px-2">
                      <Button variant="ghost" size="sm" onClick={handleZoomOut} title="Zoom Out"><ZoomOut className="h-4 w-4" /></Button>
                      <span className="text-xs font-medium text-gray-600 min-w-[3rem] text-center">{zoomLevel}%</span>
                      <Button variant="ghost" size="sm" onClick={handleZoomIn} title="Zoom In"><ZoomIn className="h-4 w-4" /></Button>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleFitAllColumns}><Maximize2 className="h-4 w-4 mr-2" />Fit All</Button>
                    <Button variant="outline" size="sm" onClick={handleResetZoom}>100%</Button>
                    <Button variant={showConfidenceColumns ? "default" : "outline"} size="sm" onClick={() => setShowConfidenceColumns(!showConfidenceColumns)}>
                      <Filter className="h-4 w-4 mr-2" />{showConfidenceColumns ? "Hide" : "Show"} Confidence
                    </Button>
                  </>
                )}
                <Button variant="outline" size="sm" onClick={handleExportCsv}><Download className="h-4 w-4 mr-2" />Export CSV</Button>
                <Button variant="outline" size="sm" onClick={() => loadRows(selectedTable.id)}>Refresh</Button>
                {viewMode === "table" && (
                  <>
                    <Button size="sm" onClick={beginNewRow}>Add Row</Button>
                    <Button size="sm" variant="outline" onClick={handleDeleteRows} disabled={selectedRowIds.length === 0}>Delete Selected</Button>
                  </>
                )}
              </div>
            </div>

            {/* Stats bar */}
            {rows.length > 0 && (
              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-500">{rows.length} rows</span>
                <span className="flex items-center gap-1 text-amber-600">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {rows.filter(r => rowNeedsReview(r) && !approvedIds.has(r.id)).length} need review
                </span>
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {approvedIds.size} approved
                </span>
              </div>
            )}

            {/* Table view */}
            {viewMode === "table" && (
              <>
                <Input
                  placeholder="Quick search all columns..."
                  value={quickFilter}
                  onChange={(e) => setQuickFilter(e.target.value)}
                  className="max-w-md"
                />
                {!selectedTable || columnDefs.length === 0 ? (
                  <p className="text-sm text-gray-500">No rows yet.</p>
                ) : (
                  <div className="overflow-auto rounded border" key={selectedTable.id}>
                    <div className="ag-theme-alpine" style={{ width: "100%", height: gridHeight, zoom: `${zoomLevel}%`, transition: 'zoom 0.2s ease' }}>
                      <AgGridReact
                        key={selectedTable.id}
                        ref={gridRef}
                        theme="legacy"
                        rowData={rowData}
                        pinnedTopRowData={pinnedTopRowData}
                        columnDefs={columnDefs}
                        getRowId={(params) => params.data?.id ?? "unknown"}
                        onCellValueChanged={handleCellValueChanged}
                        onSelectionChanged={handleSelectionChanged}
                        rowSelection="multiple"
                        rowMultiSelectWithClick
                        pagination={true}
                        paginationPageSize={50}
                        paginationPageSizeSelector={[25, 50, 100, 200]}
                        quickFilterText={quickFilter}
                        includeHiddenColumnsInQuickFilter={true}
                        cacheQuickFilter={true}
                        defaultColDef={{
                          resizable: true,
                          sortable: true,
                          filter: 'agTextColumnFilter',
                          floatingFilter: true,
                          filterParams: { filterOptions: ['contains', 'notContains', 'equals', 'notEqual', 'startsWith', 'endsWith'], defaultOption: 'contains' },
                        }}
                        suppressRowClickSelection={false}
                        animateRows={true}
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <p>Tip: Click &quot;Show Confidence&quot; to view OCR confidence scores</p>
                  <p>Color: <span className="text-green-600 font-medium">Green ≥90%</span>, <span className="text-orange-500 font-medium">Orange ≥70%</span>, <span className="text-red-600 font-medium">Red &lt;70%</span></p>
                </div>
                {showNewRowForm && (
                  <div className="flex justify-end gap-3">
                    <Button variant="outline" size="sm" onClick={() => { setShowNewRowForm(false); setNewRowForm({}); }}>Cancel Row</Button>
                    <Button size="sm" onClick={handleCreateRow}>Save Row</Button>
                  </div>
                )}
              </>
            )}

            {/* Cards view */}
            {viewMode === "cards" && (
              <>
                {rows.length === 0 ? (
                  <p className="text-sm text-gray-500">No rows yet.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {rows.map(row => (
                      <DocumentCard
                        key={row.id}
                        row={row}
                        table={selectedTable}
                        cardType={detectCardType(selectedTable.name)}
                        isApproved={approvedIds.has(row.id)}
                        editingId={editingId}
                        editValues={editValues}
                        onApprove={handleApprove}
                        onStartEdit={handleStartEdit}
                        onSaveEdit={handleSaveEdit}
                        onCancelEdit={handleCancelEdit}
                        onEditChange={handleEditChange}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Review queue view */}
            {viewMode === "review" && (
              <>
                {(() => {
                  const needsReview = rows.filter(r => rowNeedsReview(r) && !approvedIds.has(r.id));
                  const alreadyApproved = rows.filter(r => approvedIds.has(r.id));
                  return (
                    <div className="space-y-6">
                      {needsReview.length === 0 && alreadyApproved.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <CheckCircle2 className="h-12 w-12 text-green-400 mb-3" />
                          <p className="text-lg font-semibold text-gray-700">All clear!</p>
                          <p className="text-sm text-gray-500">No rows require review.</p>
                        </div>
                      ) : (
                        <>
                          {needsReview.length > 0 && (
                            <div>
                              <h3 className="text-sm font-semibold text-amber-700 mb-3 flex items-center gap-1.5">
                                <AlertCircle className="h-4 w-4" />Needs Review ({needsReview.length})
                              </h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {needsReview.map(row => (
                                  <DocumentCard
                                    key={row.id}
                                    row={row}
                                    table={selectedTable}
                                    cardType={detectCardType(selectedTable.name)}
                                    isApproved={false}
                                    editingId={editingId}
                                    editValues={editValues}
                                    onApprove={handleApprove}
                                    onStartEdit={handleStartEdit}
                                    onSaveEdit={handleSaveEdit}
                                    onCancelEdit={handleCancelEdit}
                                    onEditChange={handleEditChange}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                          {alreadyApproved.length > 0 && (
                            <div>
                              <h3 className="text-sm font-semibold text-green-700 mb-3 flex items-center gap-1.5">
                                <CheckCircle2 className="h-4 w-4" />Approved ({alreadyApproved.length})
                              </h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {alreadyApproved.map(row => (
                                  <DocumentCard
                                    key={row.id}
                                    row={row}
                                    table={selectedTable}
                                    cardType={detectCardType(selectedTable.name)}
                                    isApproved={true}
                                    editingId={editingId}
                                    editValues={editValues}
                                    onApprove={handleApprove}
                                    onStartEdit={handleStartEdit}
                                    onSaveEdit={handleSaveEdit}
                                    onCancelEdit={handleCancelEdit}
                                    onEditChange={handleEditChange}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </Card>

        </div>
      )}
    </div>
  );
}

