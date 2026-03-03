import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Save, FileText, Upload, Trash2, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { SmartConfigurePanel } from "./SmartConfigurePanel";
import { AITrainingCoach } from "./AITrainingCoach";

interface Document {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  parsed_content: string | null;
  created_at: string;
}

interface AITrainingEditorProps {
  companyId: string;
}

export const AITrainingEditor = ({ companyId }: AITrainingEditorProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [quickReferenceInfo, setQuickReferenceInfo] = useState("");
  const [originalQuickRef, setOriginalQuickRef] = useState("");
  const [documents, setDocuments] = useState<Document[]>([]);

  useEffect(() => {
    fetchData();
  }, [companyId]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch company quick reference
      const { data: company, error: companyError } = await supabase
        .from("companies")
        .select("quick_reference_info")
        .eq("id", companyId)
        .single();

      if (companyError) throw companyError;
      setQuickReferenceInfo(company?.quick_reference_info || "");
      setOriginalQuickRef(company?.quick_reference_info || "");

      // Fetch documents
      const { data: docs, error: docsError } = await supabase
        .from("company_documents")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });

      if (docsError) throw docsError;
      setDocuments(docs || []);
    } catch (error) {
      console.error("Error fetching training data:", error);
      toast.error("Failed to load training data");
    } finally {
      setIsLoading(false);
    }
  };

  const saveQuickReference = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("companies")
        .update({ quick_reference_info: quickReferenceInfo })
        .eq("id", companyId);

      if (error) throw error;
      setOriginalQuickRef(quickReferenceInfo);
      toast.success("Knowledge base saved");
    } catch (error) {
      console.error("Error saving:", error);
      toast.error("Failed to save knowledge base");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteDocument = async (docId: string) => {
    try {
      const { error } = await supabase
        .from("company_documents")
        .delete()
        .eq("id", docId);

      if (error) throw error;
      toast.success("Document deleted");
      fetchData();
    } catch (error) {
      console.error("Error deleting:", error);
      toast.error("Failed to delete document");
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const hasQuickRefChanges = quickReferenceInfo !== originalQuickRef;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* AI Training Coach */}
      <AITrainingCoach companyId={companyId} onDataChanged={fetchData} />

      {/* Smart Configure */}
      <SmartConfigurePanel companyId={companyId} onConfigApplied={fetchData} />

      {/* Quick Reference Editor */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Knowledge Base</CardTitle>
              <CardDescription>
                Core business information the AI uses to answer customer questions. Include products, prices, policies, FAQs, and important details.
              </CardDescription>
            </div>
            {hasQuickRefChanges && (
              <Button onClick={saveQuickReference} disabled={isSaving} size="sm">
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            value={quickReferenceInfo}
            onChange={(e) => setQuickReferenceInfo(e.target.value)}
            placeholder={`Example:

MENU & PRICING:
- T-bone steak: K250
- Grilled fish: K180
- Chicken wings: K120

OPENING HOURS:
Monday-Sunday: 10:00 AM - 11:00 PM

PAYMENT METHODS:
- Mobile Money (MTN, Airtel, Zamtel)
- Cash
- Bank Transfer

POLICIES:
- Reservations require 30 minutes advance notice
- Large groups (8+) require deposit
- Cancellations must be made 2 hours before`}
            className="min-h-[300px] font-mono text-sm"
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-muted-foreground">
              {quickReferenceInfo.length} characters
            </p>
            {hasQuickRefChanges && (
              <Badge variant="outline">Unsaved changes</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Document Library */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Document Library</CardTitle>
              <CardDescription>
                Uploaded documents that provide additional context for the AI.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No documents uploaded</p>
              <p className="text-sm mt-1">Upload documents in the Company Settings tab</p>
            </div>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="h-8 w-8 text-primary opacity-80 mt-1" />
                      <div>
                        <p className="font-medium">{doc.filename}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {doc.file_type}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatFileSize(doc.file_size)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(doc.created_at), "MMM d, yyyy")}
                          </span>
                        </div>
                        {doc.parsed_content && (
                          <p className="text-xs text-green-600 mt-1">
                            ✓ Parsed ({doc.parsed_content.length} chars)
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteDocument(doc.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Training Tips</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• <strong>Be specific:</strong> Include exact prices, hours, and policies</li>
            <li>• <strong>Use structure:</strong> Organize with headers and bullet points</li>
            <li>• <strong>Keep updated:</strong> Review and update regularly when things change</li>
            <li>• <strong>Test after changes:</strong> Use the Playground to verify AI responses</li>
            <li>• <strong>Log errors:</strong> If AI responds incorrectly, log it in Error Tracker</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};
