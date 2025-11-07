import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Upload, Trash2, FileText, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CompanyDocumentsProps {
  companyId: string;
}

interface Document {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  file_path: string;
  created_at: string;
  parsed_content: string | null;
}

export const CompanyDocuments = ({ companyId }: CompanyDocumentsProps) => {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    loadDocuments();
  }, [companyId]);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('company_documents')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error('Error loading documents:', error);
      toast({
        title: "Error",
        description: "Failed to load documents",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain',
    ];

    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload PDF, Word, Excel, CSV, or text files only",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 150MB)
    if (file.size > 150 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum file size is 150MB",
        variant: "destructive",
      });
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);
      
      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) return prev; // Stop at 90% until actual upload completes
          return prev + 10;
        });
      }, 300);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Upload to storage
      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      
      const { error: uploadError } = await supabase.storage
        .from('company-documents')
        .upload(filePath, file);

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (uploadError) throw uploadError;

      // Create document record
      const { data: doc, error: docError } = await supabase
        .from('company_documents')
        .insert({
          company_id: companyId,
          filename: file.name,
          file_path: filePath,
          file_type: file.type,
          file_size: file.size,
          uploaded_by: user.id,
        })
        .select()
        .single();

      if (docError) throw docError;

      // Parse document in background
      supabase.functions.invoke('parse-document', {
        body: { documentId: doc.id }
      }).then(() => {
        loadDocuments();
      });

      toast({
        title: "Success",
        description: "Document uploaded successfully",
      });

      loadDocuments();
      event.target.value = '';
    } catch (error) {
      console.error('Error uploading document:', error);
      toast({
        title: "Error",
        description: "Failed to upload document",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDelete = async (documentId: string, filePath: string) => {
    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('company-documents')
        .remove([filePath]);

      if (storageError) throw storageError;

      // Delete record
      const { error: dbError } = await supabase
        .from('company_documents')
        .delete()
        .eq('id', documentId);

      if (dbError) throw dbError;

      toast({
        title: "Success",
        description: "Document deleted successfully",
      });

      loadDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      toast({
        title: "Error",
        description: "Failed to delete document",
        variant: "destructive",
      });
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <Card className="card-glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Company Documents
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Upload documents that the AI can reference when answering customer questions
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="document-upload">
            Upload Document (PDF, Word, Excel, CSV, or Text)
          </Label>
          <div className="flex gap-2">
            <Input
              id="document-upload"
              type="file"
              onChange={handleFileUpload}
              disabled={uploading}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              className="flex-1"
            />
            {uploading && <Loader2 className="h-5 w-5 animate-spin" />}
          </div>
          {uploading && uploadProgress > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Uploading...</span>
                <span className="font-medium">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : documents.length > 0 ? (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{doc.filename}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatFileSize(doc.file_size)} • {new Date(doc.created_at).toLocaleDateString()}
                    {doc.parsed_content && (
                      <span className="ml-2 text-green-600">✓ Parsed</span>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(doc.id, doc.file_path)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">
            No documents uploaded yet
          </p>
        )}
      </CardContent>
    </Card>
  );
};