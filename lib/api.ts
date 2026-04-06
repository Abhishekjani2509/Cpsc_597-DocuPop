import { authService } from './auth-service';

const API_BASE = (process.env.NEXT_PUBLIC_LOCAL_API_BASE || '').replace(/\/$/, '');
const API_PREFIX = `${API_BASE}/api`;

const buildUrl = (path: string) => `${API_PREFIX}${path}`;

function getAuthHeaders(): HeadersInit {
  const token = authService.getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export interface Document {
  id: number;
  filename: string;
  file_size: number;
  content_type: string;
  created_at: string;
}

export interface DataField {
  id: string;
  table_id: string;
  name: string;
  data_type: string;
  position: number;
}

export interface DataTable {
  id: string;
  name: string;
  description?: string | null;
  created_at: string;
  fields: DataField[];
  mappings?: DataFieldMapping[];
}

export interface DataFieldMapping {
  id: string;
  table_id: string;
  source_label: string;
  target_field: string;
  matcher: string;
}

export interface TextractQuery {
  text: string;
  alias?: string;
  pages?: string[];
}

export interface TextractAdapterVersion {
  version: string;
  status: string;
  createdAt: string | null;
}

export interface TextractAdapter {
  id: string;
  name: string;
  featureTypes: string[];
  versions: TextractAdapterVersion[];
}

export interface DataRow {
  id: string;
  table_id: string;
  data: Record<string, any>;
  created_at: string;
  updated_at?: string;
}

export interface ProcessingJob {
  id: string;
  document_id: number;
  status: string;
  engine: string;
  result?: any;
  confidence?: number | null;
  error?: string | null;
  target_table_id?: string | null;
  target_table?: {
    id: string;
    name: string;
  };
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

async function handleResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type');
  const isJson = contentType?.includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const message = payload?.error || payload?.message || 'Request failed';
    throw new Error(message);
  }

  return payload as T;
}

async function requestJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(buildUrl(path), {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(init?.headers || {}),
    },
  });

  return handleResponse<T>(response);
}

export const apiService = {
  validateFile(file: File): void {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = [
      'text/plain',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (file.size > maxSize) {
      throw new Error(`File size exceeds ${maxSize / (1024 * 1024)}MB limit`);
    }

    if (!allowedTypes.includes(file.type)) {
      throw new Error(`File type ${file.type} is not allowed`);
    }

    const allowedExtensions = ['.txt', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.doc', '.docx'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
      throw new Error(`File extension ${fileExtension} is not allowed`);
    }
  },

  async uploadDocument(file: File): Promise<Document> {
    this.validateFile(file);

    // Convert file to base64
    const base64Content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:application/pdf;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const data = await requestJson<{ document: Document }>('/documents', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        content: base64Content,
        contentType: file.type,
      }),
    });

    return data.document;
  },

  async listDocuments(): Promise<Document[]> {
    const data = await requestJson<{ documents: Document[] }>('/documents');
    return data.documents;
  },

  async getDocument(documentId: number): Promise<Document> {
    const data = await requestJson<{ document: Document }>(`/documents/${documentId}`);
    return data.document;
  },

  async deleteDocument(documentId: number): Promise<void> {
    await requestJson<{ success: boolean }>(`/documents/${documentId}`, { method: 'DELETE' });
  },

  async getDocumentDownloadUrl(documentId: number): Promise<string> {
    const data = await requestJson<{ url: string }>(`/documents/${documentId}/download`);
    return data.url;
  },

  async getDocumentViewUrl(documentId: number): Promise<string> {
    const data = await requestJson<{ url: string }>(`/documents/${documentId}/view`);
    return data.url;
  },

  async listProcessingJobs(): Promise<ProcessingJob[]> {
    const data = await requestJson<{ jobs: ProcessingJob[] }>('/processing');
    return data.jobs;
  },

  async queueProcessingJobs(
    documentIds: number[],
    engine?: string,
    targetTableId?: string | null,
    options?: {
      queries?: TextractQuery[];
      adapterId?: string;
      adapterVersion?: string;
    }
  ): Promise<ProcessingJob[]> {
    const data = await requestJson<{ jobs: ProcessingJob[] }>('/processing', {
      method: 'POST',
      body: JSON.stringify({
        documentIds,
        engine,
        targetTableId,
        queries: options?.queries,
        adapterId: options?.adapterId,
        adapterVersion: options?.adapterVersion,
      }),
    });
    return data.jobs;
  },

  async deleteProcessingJob(jobId: string): Promise<void> {
    await requestJson<{ success: boolean }>(`/processing/${jobId}`, { method: 'DELETE' });
  },

  async listTextractAdapters(): Promise<TextractAdapter[]> {
    const data = await requestJson<{ adapters: TextractAdapter[] }>('/textract/adapters');
    return data.adapters;
  },

  async listDataTables(): Promise<DataTable[]> {
    const data = await requestJson<{ tables: DataTable[] }>('/data/tables');
    return data.tables;
  },

  async createDataTable(payload: {
    name: string;
    description?: string;
    fields: Array<{ name: string; data_type?: string }>;
  }): Promise<DataTable> {
    const data = await requestJson<{ table: DataTable }>('/data/tables', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data.table;
  },

  async getDataTable(tableId: string): Promise<DataTable> {
    const data = await requestJson<{ table: DataTable }>(`/data/tables/${tableId}`);
    return data.table;
  },

  async deleteDataTable(tableId: string): Promise<void> {
    await requestJson<{ success: boolean }>(`/data/tables/${tableId}`, { method: 'DELETE' });
  },

  async importCsv(tableId: string, file: File): Promise<number> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(buildUrl(`/data/tables/${tableId}/import`), {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...getAuthHeaders(),
      },
      body: formData,
    });
    const data = await handleResponse<{ inserted: number }>(response);
    return data.inserted;
  },

  async listDataRows(tableId: string): Promise<DataRow[]> {
    const data = await requestJson<{ rows: DataRow[] }>(`/data/tables/${tableId}/rows`);
    return data.rows;
  },

  async addDataRows(tableId: string, rows: Record<string, any>[]): Promise<void> {
    await requestJson<{ success: boolean }>(`/data/tables/${tableId}/rows`, {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
  },

  async updateDataTable(tableId: string, payload: { name?: string; description?: string | null }): Promise<DataTable> {
    const data = await requestJson<{ table: DataTable }>(`/data/tables/${tableId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return data.table;
  },

  async updateDataRow(tableId: string, rowId: string, dataObj: Record<string, any>): Promise<DataRow> {
    const data = await requestJson<{ row: DataRow }>(`/data/tables/${tableId}/rows/${rowId}`, {
      method: 'PATCH',
      body: JSON.stringify(dataObj),
    });
    return data.row;
  },

  async deleteDataRow(tableId: string, rowId: string): Promise<void> {
    await requestJson<{ success: boolean }>(`/data/tables/${tableId}/rows/${rowId}`, {
      method: 'DELETE',
    });
  },

  async listFieldMappings(tableId: string): Promise<DataFieldMapping[]> {
    const data = await requestJson<{ mappings: DataFieldMapping[] }>(`/data/tables/${tableId}/mappings`);
    return data.mappings;
  },

  async createFieldMapping(tableId: string, payload: { sourceLabel: string; targetField: string; matcher?: string }): Promise<DataFieldMapping> {
    const data = await requestJson<{ mapping: DataFieldMapping }>(`/data/tables/${tableId}/mappings`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data.mapping;
  },

  async deleteFieldMapping(tableId: string, mappingId: string): Promise<void> {
    await requestJson<{ success: boolean }>(`/data/tables/${tableId}/mappings/${mappingId}`, {
      method: 'DELETE',
    });
  },

  async addField(tableId: string, fieldName: string, dataType: string = 'text'): Promise<DataField> {
    const data = await requestJson<{ field: DataField }>(`/data/tables/${tableId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: fieldName, data_type: dataType }),
    });
    return data.field;
  },
};

