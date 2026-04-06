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
import { Download, Filter, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { toast } from "@/components/ui/toast";

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
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">{selectedTable.name} Rows</h2>
                <p className="text-sm text-gray-500">{rows.length} total rows</p>
              </div>
              <div className="flex gap-2">
                <div className="flex items-center gap-1 border rounded-md px-2">
                  <Button variant="ghost" size="sm" onClick={handleZoomOut} title="Zoom Out (10%)">
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="text-xs font-medium text-gray-600 min-w-[3rem] text-center">{zoomLevel}%</span>
                  <Button variant="ghost" size="sm" onClick={handleZoomIn} title="Zoom In (10%)">
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={handleFitAllColumns} title="Fit all columns in view">
                  <Maximize2 className="h-4 w-4 mr-2" />
                  Fit All
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetZoom} title="Reset to 100%">
                  100%
                </Button>
                <Button
                  variant={showConfidenceColumns ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowConfidenceColumns(!showConfidenceColumns)}
                >
                  <Filter className="h-4 w-4 mr-2" />
                  {showConfidenceColumns ? "Hide" : "Show"} Confidence
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportCsv}>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => loadRows(selectedTable.id)}>
                  Refresh
                </Button>
                <Button size="sm" onClick={beginNewRow}>
                  Add Row
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDeleteRows}
                  disabled={selectedRowIds.length === 0}
                >
                  Delete Selected
                </Button>
              </div>
            </div>
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
                <div
                  className="ag-theme-alpine"
                  style={{
                    width: "100%",
                    height: gridHeight,
                    zoom: `${zoomLevel}%`,
                    transition: 'zoom 0.2s ease'
                  }}
                >
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
                      filterParams: {
                        filterOptions: ['contains', 'notContains', 'equals', 'notEqual', 'startsWith', 'endsWith'],
                        defaultOption: 'contains',
                      },
                    }}
                    suppressRowClickSelection={false}
                    animateRows={true}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <p>Tip: Click &quot;Show Confidence&quot; button above to view OCR confidence scores for each field</p>
              <p>Color coding: <span className="text-green-600 font-medium">Green &gt;=90%</span>, <span className="text-orange-500 font-medium">Orange &gt;=70%</span>, <span className="text-red-600 font-medium">Red &lt;70%</span></p>
            </div>
            {showNewRowForm && (
              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowNewRowForm(false);
                    setNewRowForm({});
                  }}
                >
                  Cancel Row
                </Button>
                <Button size="sm" onClick={handleCreateRow}>
                  Save Row
                </Button>
              </div>
            )}
          </Card>

        </div>
      )}
    </div>
  );
}

