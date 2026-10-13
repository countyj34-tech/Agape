import React, { useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Upload, FileCheck, AlertCircle, CheckCircle, Loader2, X } from 'lucide-react';
import type { ParallelBusiness, ParallelBranch } from '@/types/pos';
import {
  getParallelBusinesses,
  getBranchesByBusiness,
  uploadFile,
  createUploadedFile,
  createProcessingLog,
} from '@/lib/parallelSupabase';
import { processFile, detectFileFormat } from '@/lib/parallelFileProcessing';

interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  error?: string;
}

export default function ParallelAdminUploadScreen() {
  const [businesses, setBusinesses] = useState<ParallelBusiness[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [branches, setBranches] = useState<ParallelBranch[]>([]);
  
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, UploadProgress>>(new Map());
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load businesses on mount
  React.useEffect(() => {
    loadBusinesses();
  }, []);

  async function loadBusinesses() {
    setLoading(true);
    try {
      const data = await getParallelBusinesses();
      setBusinesses(data);
    } catch (error) {
      toast.error('Failed to load businesses');
    } finally {
      setLoading(false);
    }
  }

  async function handleBusinessChange(businessId: string) {
    setSelectedBusiness(businessId);
    setSelectedBranch('');
    try {
      const data = await getBranchesByBusiness(businessId);
      setBranches(data);
    } catch (error) {
      toast.error('Failed to load branches');
    }
  }

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!selectedBranch) {
      toast.error('Please select a branch first');
      return;
    }

    const fileArray = Array.from(files);
    const maxSize = 50 * 1024 * 1024; // 50MB

    for (const file of fileArray) {
      if (file.size > maxSize) {
        toast.error(`File ${file.name} is too large. Maximum size is 50MB.`);
        continue;
      }

      const key = `${file.name}-${Date.now()}`;
      setUploadingFiles((prev) => new Map(prev).set(key, {
        fileName: file.name,
        progress: 0,
        status: 'uploading',
      }));

      try {
        await processAndUploadFile(file, key);
      } catch (error) {
        setUploadingFiles((prev) => {
          const updated = new Map(prev);
          const progress = updated.get(key);
          if (progress) {
            progress.status = 'failed';
            progress.error = error instanceof Error ? error.message : 'Upload failed';
          }
          return updated;
        });
        toast.error(`Failed to upload ${file.name}`);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function processAndUploadFile(file: File, key: string) {
    const business = businesses.find((b) => b.id === selectedBusiness);
    const branch = branches.find((br) => br.id === selectedBranch);

    if (!business || !branch) {
      throw new Error('Invalid business or branch');
    }

    // Update progress to processing
    setUploadingFiles((prev) => {
      const updated = new Map(prev);
      const progress = updated.get(key);
      if (progress) {
        progress.status = 'processing';
        progress.progress = 30;
      }
      return updated;
    });

    // Process file to extract data
    const processingResult = await processFile(file);
    setUploadingFiles((prev) => {
      const updated = new Map(prev);
      const progress = updated.get(key);
      if (progress) progress.progress = 60;
      return updated;
    });

    if (!processingResult.success) {
      throw new Error(processingResult.error || 'Failed to process file');
    }

    // Upload file to Supabase storage
    const filePath = await uploadFile(file, business.id, branch.id, 'admin@mthunzi.com');
    if (!filePath) {
      throw new Error('Failed to upload file to storage');
    }

    setUploadingFiles((prev) => {
      const updated = new Map(prev);
      const progress = updated.get(key);
      if (progress) progress.progress = 80;
      return updated;
    });

    // Create database record
    const fileFormat = detectFileFormat(file.name, file.type);
    const uploadedFileRecord = await createUploadedFile({
      businessId: business.id,
      branchId: branch.id,
      fileName: file.name,
      fileFormat,
      fileSize: file.size,
      fileUrl: filePath,
      uploadedBy: 'admin@mthunzi.com',
      processStatus: 'completed',
      processedData: processingResult.data,
    });

    if (!uploadedFileRecord) {
      throw new Error('Failed to create file record');
    }

    // Log success
    await createProcessingLog({
      uploadedFileId: uploadedFileRecord.id,
      level: 'success',
      message: `File processed successfully: ${file.name}`,
      details: {
        fileFormat,
        itemsExtracted: processingResult.data?.openingStockItems?.length || 0,
      },
      processedAt: new Date(),
    });

    setUploadingFiles((prev) => {
      const updated = new Map(prev);
      const progress = updated.get(key);
      if (progress) {
        progress.status = 'completed';
        progress.progress = 100;
      }
      return updated;
    });

    toast.success(`${file.name} uploaded and processed successfully`);
  }

  return (
    <div className="w-full max-w-6xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Upload Stock Data</h1>
        <p className="text-gray-600">Upload business stock files for analysis and reporting</p>
      </div>

      {/* Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Business Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Business</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={selectedBusiness} onValueChange={handleBusinessChange}>
              <SelectTrigger>
                <SelectValue placeholder="Choose business..." />
              </SelectTrigger>
              <SelectContent>
                {businesses.map((biz) => (
                  <SelectItem key={biz.id} value={biz.id}>
                    {biz.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBusiness && (
              <div className="text-sm text-gray-600">
                <p className="font-medium">Owner: {businesses.find((b) => b.id === selectedBusiness)?.ownerName}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Branch Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Branch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={!selectedBusiness}>
              <SelectTrigger>
                <SelectValue placeholder={selectedBusiness ? 'Choose branch...' : 'Select business first'} />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBranch && (
              <div className="text-sm text-gray-600">
                <p className="font-medium">Location: {branches.find((b) => b.id === selectedBranch)?.location}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upload Area */}
      {selectedBranch && (
        <Card className="border-2 border-dashed border-green-300 bg-green-50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload Stock File
            </CardTitle>
            <CardDescription>
              Supported formats: Excel (.xlsx), CSV, PDF, or Images (JPG/PNG)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="border-2 border-dashed border-green-200 rounded-lg p-8 text-center">
                <div className="space-y-3">
                  <Upload className="w-12 h-12 mx-auto text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-700">Drag and drop files here or click to browse</p>
                    <p className="text-xs text-gray-500">Maximum file size: 50MB</p>
                  </div>
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    variant="default"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Browse Files
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.gif"
                  onChange={(e) => handleFileSelect(e.currentTarget.files)}
                  className="hidden"
                />
              </div>

              {/* Upload Progress */}
              {uploadingFiles.size > 0 && (
                <div className="space-y-3">
                  <Separator />
                  <h3 className="font-medium text-sm">Upload Progress</h3>
                  {Array.from(uploadingFiles.entries()).map(([key, progress]) => (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {progress.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />}
                          {progress.status === 'processing' && <Loader2 className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0" />}
                          {progress.status === 'failed' && <X className="w-4 h-4 text-red-600 flex-shrink-0" />}
                          <span className="text-sm truncate">{progress.fileName}</span>
                        </div>
                        <Badge variant={
                          progress.status === 'completed' ? 'default' :
                          progress.status === 'failed' ? 'destructive' :
                          'secondary'
                        }>
                          {progress.status}
                        </Badge>
                      </div>
                      {progress.status !== 'failed' && (
                        <Progress value={progress.progress} className="h-2" />
                      )}
                      {progress.error && (
                        <Alert variant="destructive" className="py-2">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription className="text-xs">{progress.error}</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Alert */}
      <Alert className="bg-blue-50 border-blue-200">
        <AlertCircle className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800">
          Files are automatically processed and analyzed. The system will extract stock data and prepare reports for your review and approval.
        </AlertDescription>
      </Alert>
    </div>
  );
}
