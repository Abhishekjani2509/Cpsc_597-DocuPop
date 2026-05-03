"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Download, Trash2, Eye, Upload, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiService, Document } from "@/lib/api";
import { useRouter } from "next/navigation";
import FileUpload from "@/components/FileUpload";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export default function DocumentsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [search, setSearch] = useState("");
  const filteredDocs = documents.filter(d =>
    d.filename.toLowerCase().includes(search.toLowerCase()) ||
    d.content_type.toLowerCase().includes(search.toLowerCase())
  );

  const loadDocuments = useCallback(async () => {
    try {
      const items = await apiService.listDocuments();
      setDocuments(items);
    } catch (error) {
      console.error("Failed to load documents:", error);
    } finally {
      setPageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      setPageLoading(false);
      router.push("/");
      return;
    }

    setPageLoading(true);
    loadDocuments();
  }, [loading, user, router, loadDocuments]);

  const handleUploadSuccess = (_document: Document) => {
    loadDocuments();
  };

  const handleUploadError = (error: string) => {
    console.error("Upload failed:", error);
    toast.error("Upload failed", error);
  };

  const handleDeleteDocument = async (documentId: number) => {
    if (!window.confirm("Are you sure you want to delete this document?")) return;

    try {
      await apiService.deleteDocument(documentId);
      await loadDocuments();
      toast.success("Document deleted successfully");
    } catch (error) {
      console.error("Delete failed:", error);
      toast.error("Delete failed. Please try again.");
    }
  };

  const handleDownloadDocument = async (documentId: number) => {
    try {
      const url = await apiService.getDocumentDownloadUrl(documentId);
      window.open(url, '_blank');
    } catch (error) {
      console.error("Download failed:", error);
      toast.error("Failed to download document");
    }
  };

  const handleViewDocument = async (documentId: number) => {
    try {
      const url = await apiService.getDocumentViewUrl(documentId);
      window.open(url, '_blank');
    } catch (error) {
      console.error("View failed:", error);
      toast.error("Failed to view document");
    }
  };


  if (pageLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="space-y-3 mb-8">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-6 w-96" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-6 py-12 space-y-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Documents</h1>
          <p className="text-gray-600 mt-2">
            Upload and manage your documents. Go to Processing to queue OCR jobs.
          </p>
        </div>

        {/* Upload Section */}
        <Card className="border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors">
          <CardContent className="pt-6">
            <FileUpload
              onUploadSuccess={handleUploadSuccess}
              onUploadError={handleUploadError}
            />
          </CardContent>
        </Card>

        {/* Documents List */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-gray-600" />
                <span>Your Documents</span>
              </div>
              <span className="text-sm font-normal text-gray-500">
                {filteredDocs.length} of {documents.length} {documents.length === 1 ? 'document' : 'documents'}
              </span>
            </CardTitle>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by filename or type…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {documents.length === 0 ? (
              <EmptyState
                icon={Upload}
                title="No documents uploaded yet"
                description="Upload your first document to get started with OCR processing"
              />
            ) : filteredDocs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No documents match &quot;{search}&quot;</p>
            ) : (
              <div className="space-y-3">
                {filteredDocs.map((doc) => (
                  <Card
                    key={doc.id}
                    className="hover:shadow-md transition-all"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <FileText className="h-10 w-10 text-blue-500 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <h3 className="font-semibold text-gray-900 truncate">{doc.filename}</h3>
                            <p className="text-sm text-gray-500 mt-1">
                              {(doc.file_size / 1024).toFixed(1)} KB • {doc.content_type} • {new Date(doc.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewDocument(doc.id)}
                            title="View document"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownloadDocument(doc.id)}
                            title="Download document"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDeleteDocument(doc.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="Delete document"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
