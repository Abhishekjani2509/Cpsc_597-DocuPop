"use client";

import { useState, useRef, ChangeEvent, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FileText, Search, Upload, X, CheckCircle, AlertCircle } from "lucide-react";
import { apiService } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

interface UploadFile {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
  file: File;
}

interface Model {
  id: string;
  name: string;
  count: number;
}

export default function UploadPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [selectedModel, setSelectedModel] = useState("finance");
  const [searchQuery, setSearchQuery] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const models: Model[] = [
    { id: "finance", name: "Finance Model", count: 1 },
    { id: "executive", name: "Executive Model", count: 51 },
    { id: "medical", name: "Medical Model", count: 1 },
  ];

  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
  }, [loading, user, router]);

  const filteredModels = models.filter((model) =>
    model.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const newFiles = Array.from(event.target.files).map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        size: file.size,
        progress: 0,
        status: 'pending' as const,
        file: file
      }));
      
      setFiles(prev => [...prev, ...newFiles]);
      setUploadError(null);
    }
  };

  const validateFile = (file: File): string | null => {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/jpeg',
      'image/png'
    ];

    if (file.size > maxSize) {
      return 'File size must be less than 10MB';
    }

    if (!allowedTypes.includes(file.type)) {
      return 'File type not supported. Please upload PDF, DOC, DOCX, TXT, JPG, or PNG files.';
    }

    return null;
  };

  const uploadFile = async (uploadFile: UploadFile) => {
    const validationError = validateFile(uploadFile.file);
    if (validationError) {
      setFiles(prev => prev.map(f => 
        f.id === uploadFile.id 
          ? { ...f, status: 'error', error: validationError }
          : f
      ));
      return;
    }

    setFiles(prev => prev.map(f => 
      f.id === uploadFile.id 
        ? { ...f, status: 'uploading', progress: 0 }
        : f
    ));

    try {
      const result = await apiService.uploadDocument(uploadFile.file);
      
      setFiles(prev => prev.map(f => 
        f.id === uploadFile.id 
          ? { ...f, status: 'completed', progress: 100 }
          : f
      ));
    } catch (error: any) {
      setFiles(prev => prev.map(f => 
        f.id === uploadFile.id 
          ? { ...f, status: 'error', error: error.message || 'Upload failed' }
          : f
      ));
    }
  };

  const handleUploadAll = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);

    const pendingFiles = files.filter(f => f.status === 'pending');
    
    // Upload files sequentially to avoid overwhelming the server
    for (const file of pendingFiles) {
      await uploadFile(file);
    }

    setIsUploading(false);
  };

  const removeFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const handleClearAll = () => {
    setFiles([]);
    setUploadError(null);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'uploading':
        return <Upload className="h-4 w-4 text-blue-500 animate-pulse" />;
      default:
        return <FileText className="h-4 w-4 text-gray-400" />;
    }
  };

  const getProgressColor = (status: string) => {
    switch (status) {
      case 'completed':
        return "bg-green-500";
      case 'error':
        return "bg-red-500";
      case 'uploading':
        return "bg-blue-500";
      default:
        return "bg-gray-400";
    }
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Bar */}
      <div className="border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">DOCUPOP</h1>
          <Button onClick={handleSignOut} variant="outline">
            Sign Out
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-4xl px-6 py-12">
        {/* Upload Area */}
        <Card className="mb-8 bg-gray-100 p-12">
          <div className="flex flex-col items-center justify-center space-y-6">
            <FileText className="h-16 w-16 text-gray-400" />
            <p className="text-lg text-gray-700">
              {files.length === 0 ? "No documents selected for upload." : `${files.length} document(s) ready for upload.`}
            </p>
            <div className="flex gap-4">
              <input
                ref={fileInputRef}
                type="file"
                id="docpicker"
                accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
                onChange={onFileChange}
                multiple
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="bg-blue-500 hover:bg-blue-600"
              >
                <Upload className="h-4 w-4 mr-2" />
                Choose Files
              </Button>
            </div>
            {files.length > 0 && (
              <div className="flex gap-4">
                <Button
                  onClick={handleUploadAll}
                  className="bg-green-500 hover:bg-green-600"
                  disabled={isUploading || files.every(f => f.status !== 'pending')}
                >
                  {isUploading ? 'Uploading...' : 'Upload All'}
                </Button>
                <Button
                  onClick={handleClearAll}
                  variant="outline"
                  className="bg-gray-300 hover:bg-gray-400"
                >
                  Clear All
                </Button>
              </div>
            )}
            {uploadError && (
              <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
                {uploadError}
              </div>
            )}
          </div>
        </Card>

        {/* File List */}
        {files.length > 0 && (
          <Card className="mb-8 p-6">
            <div className="space-y-1">
              <div className="mb-4 grid grid-cols-4 border-b pb-2">
                <div className="font-semibold text-gray-700">File</div>
                <div className="font-semibold text-gray-700">Size</div>
                <div className="font-semibold text-gray-700">Status</div>
                <div className="font-semibold text-gray-700">Actions</div>
              </div>
              {files.map((file) => (
                <div key={file.id} className="grid grid-cols-4 items-center py-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(file.status)}
                    <span className="text-gray-600 truncate">{file.name}</span>
                  </div>
                  <div className="text-gray-500 text-sm">
                    {formatFileSize(file.size)}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative h-4 w-32 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className={`h-full transition-all ${getProgressColor(file.status)}`}
                        style={{ width: `${file.progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 capitalize">
                      {file.status === 'uploading' ? 'Uploading...' : file.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {file.status === 'error' && (
                      <span className="text-xs text-red-500 truncate" title={file.error}>
                        {file.error}
                      </span>
                    )}
                    {file.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removeFile(file.id)}
                        className="h-6 px-2 text-xs"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Model Selection */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">
            Select which Model to use for OCR
          </h2>
          <Card className="p-6">
            <div className="space-y-3">
              {filteredModels.map((model) => (
                <div
                  key={model.id}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors ${
                    selectedModel === model.id
                      ? "border-cyan-400 bg-cyan-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                  onClick={() => setSelectedModel(model.id)}
                >
                  <span
                    className={`font-medium ${
                      selectedModel === model.id
                        ? "text-cyan-600"
                        : "text-gray-700"
                    }`}
                  >
                    {model.name}
                  </span>
                  <Badge
                    variant="secondary"
                    className={`${
                      selectedModel === model.id
                        ? "bg-cyan-500 text-white"
                        : "bg-gray-200 text-gray-700"
                    }`}
                  >
                    {model.count}
                  </Badge>
                </div>
              ))}
              <div className="relative">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search models..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </Card>

          {/* Action Buttons */}
          <div className="flex justify-between gap-3">
            <Button 
              variant="outline" 
              onClick={() => router.push('/documents')}
            >
              View Documents
            </Button>
            <div className="flex gap-3">
              <Button 
                variant="outline"
                onClick={() => router.push('/')}
              >
                Back to Home
              </Button>
              <Button 
                className="bg-green-500 hover:bg-green-600"
                disabled={files.length === 0 || files.every(f => f.status !== 'completed')}
                onClick={() => {
                  // TODO: Implement OCR processing
                  alert('OCR processing will be implemented in the next phase');
                }}
              >
                Process with OCR
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
