"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, Image, File, X, CheckCircle, AlertCircle } from "lucide-react";
import { apiService, Document } from "@/lib/api";

interface FileUploadProps {
  onUploadSuccess?: (document: Document) => void;
  onUploadError?: (error: string) => void;
}

interface UploadFile {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  document?: Document;
}

const ALLOWED_FILE_TYPES = {
  'text/plain': ['.txt'],
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default function FileUpload({ onUploadSuccess, onUploadError }: FileUploadProps) {
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validate file type and size
  const validateFile = (file: File): string | null => {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return `File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit`;
    }

    // Check file type
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    const mimeType = file.type;
    
    if (!ALLOWED_FILE_TYPES[mimeType as keyof typeof ALLOWED_FILE_TYPES]) {
      return `File type ${fileExtension} is not allowed`;
    }

    const allowedExtensions = ALLOWED_FILE_TYPES[mimeType as keyof typeof ALLOWED_FILE_TYPES];
    if (!allowedExtensions.includes(fileExtension)) {
      return `File extension ${fileExtension} is not allowed for ${mimeType}`;
    }

    return null;
  };

  // Get file icon based on type
  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) {
      return <Image className="h-8 w-8 text-green-500" />;
    } else if (file.type === 'application/pdf') {
      return <FileText className="h-8 w-8 text-red-500" />;
    } else {
      return <File className="h-8 w-8 text-blue-500" />;
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Handle file selection
  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;

    const newFiles: UploadFile[] = Array.from(files).map(file => {
      const validationError = validateFile(file);
      return {
        file,
        id: Math.random().toString(36).substr(2, 9),
        status: validationError ? 'error' : 'pending',
        progress: 0,
        error: validationError || undefined,
      };
    });

    setUploadFiles(prev => [...prev, ...newFiles]);

    // Auto-upload valid files
    newFiles.forEach(uploadFile => {
      if (uploadFile.status === 'pending') {
        uploadFileToServer(uploadFile);
      }
    });
  }, []);

  // Upload file to local API
  const uploadFileToServer = async (uploadFile: UploadFile) => {
    try {
      setUploadFiles(prev => prev.map(f => 
        f.id === uploadFile.id ? { ...f, status: 'uploading', progress: 0 } : f
      ));

      setUploadFiles(prev => prev.map(f => 
        f.id === uploadFile.id ? { ...f, progress: 50 } : f
      ));

      const document = await apiService.uploadDocument(uploadFile.file);

      setUploadFiles(prev => prev.map(f => 
        f.id === uploadFile.id ? { 
          ...f, 
          status: 'success', 
          progress: 100,
          document
        } : f
      ));

      onUploadSuccess?.(document);
    } catch (error) {
      console.error('Upload failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      
      setUploadFiles(prev => prev.map(f => 
        f.id === uploadFile.id ? { 
          ...f, 
          status: 'error', 
          error: errorMessage 
        } : f
      ));

      onUploadError?.(errorMessage);
    }
  };

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // Handle file input change
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    // Reset input value to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove file from list
  const removeFile = (fileId: string) => {
    setUploadFiles(prev => prev.filter(f => f.id !== fileId));
  };

  // Retry upload
  const retryUpload = (fileId: string) => {
    const uploadFile = uploadFiles.find(f => f.id === fileId);
    if (uploadFile && uploadFile.status === 'error') {
      uploadFileToServer({ ...uploadFile, status: 'pending', error: undefined });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Upload Files
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Drop Zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragOver 
              ? 'border-blue-500 bg-blue-50' 
              : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-900 mb-2">
            Drag and drop files here, or click to select
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Supports: PDF, DOC, DOCX, TXT, JPG, PNG, GIF (max 10MB each)
          </p>
          <Button
            onClick={() => fileInputRef.current?.click()}
            variant="outline"
            className="mb-2"
          >
            Choose Files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.gif"
          />
        </div>

        {/* Upload Progress */}
        {uploadFiles.length > 0 && (
          <div className="mt-6 space-y-4">
            <h3 className="font-medium text-gray-900">Upload Progress</h3>
            {uploadFiles.map((uploadFile) => (
              <div key={uploadFile.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {getFileIcon(uploadFile.file)}
                    <div>
                      <p className="font-medium text-gray-900">{uploadFile.file.name}</p>
                      <p className="text-sm text-gray-500">
                        {formatFileSize(uploadFile.file.size)} â€¢ {uploadFile.file.type}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {uploadFile.status === 'success' && (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    )}
                    {uploadFile.status === 'error' && (
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeFile(uploadFile.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {uploadFile.status === 'uploading' && (
                  <div className="space-y-2">
                    <Progress value={uploadFile.progress} className="w-full" />
                    <p className="text-sm text-gray-600">
                      Uploading... {uploadFile.progress}%
                    </p>
                  </div>
                )}

                {uploadFile.status === 'success' && (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="h-4 w-4" />
                    <span className="text-sm">Upload successful!</span>
                  </div>
                )}

                {uploadFile.status === 'error' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-red-600">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm">{uploadFile.error}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryUpload(uploadFile.id)}
                    >
                      Retry Upload
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
