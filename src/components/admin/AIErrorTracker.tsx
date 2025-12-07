import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, CheckCircle, XCircle, Plus, Trash2, Edit, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface ErrorLog {
  id: string;
  error_type: string;
  severity: string;
  original_message: string;
  ai_response: string;
  expected_response: string | null;
  status: string;
  fix_applied: string | null;
  created_at: string;
  conversation_id: string | null;
}

interface AIErrorTrackerProps {
  companyId: string;
}

export const AIErrorTracker = ({ companyId }: AIErrorTrackerProps) => {
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedError, setSelectedError] = useState<ErrorLog | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newError, setNewError] = useState({
    error_type: "wrong_response",
    severity: "medium",
    original_message: "",
    ai_response: "",
    expected_response: "",
  });
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetchErrors();
  }, [companyId]);

  const fetchErrors = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("ai_error_logs")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setErrors(data || []);
    } catch (error) {
      console.error("Error fetching error logs:", error);
      toast.error("Failed to load error logs");
    } finally {
      setIsLoading(false);
    }
  };

  const addError = async () => {
    try {
      const { error } = await supabase.from("ai_error_logs").insert({
        company_id: companyId,
        ...newError,
      });

      if (error) throw error;
      toast.success("Error logged successfully");
      setIsAddDialogOpen(false);
      setNewError({
        error_type: "wrong_response",
        severity: "medium",
        original_message: "",
        ai_response: "",
        expected_response: "",
      });
      fetchErrors();
    } catch (error) {
      console.error("Error adding error log:", error);
      toast.error("Failed to log error");
    }
  };

  const updateStatus = async (id: string, status: string, fixApplied?: string) => {
    try {
      const { error } = await supabase
        .from("ai_error_logs")
        .update({ status, fix_applied: fixApplied || null })
        .eq("id", id);

      if (error) throw error;
      toast.success(`Error marked as ${status}`);
      fetchErrors();
      setSelectedError(null);
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
    }
  };

  const deleteError = async (id: string) => {
    try {
      const { error } = await supabase.from("ai_error_logs").delete().eq("id", id);
      if (error) throw error;
      toast.success("Error log deleted");
      fetchErrors();
    } catch (error) {
      console.error("Error deleting:", error);
      toast.error("Failed to delete error log");
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "destructive";
      case "high": return "destructive";
      case "medium": return "default";
      case "low": return "secondary";
      default: return "outline";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "fixed": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "ignored": return <XCircle className="h-4 w-4 text-muted-foreground" />;
      default: return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    }
  };

  const filteredErrors = errors.filter(e => {
    if (filter === "all") return true;
    return e.status === filter;
  });

  const stats = {
    total: errors.length,
    open: errors.filter(e => e.status === "open").length,
    fixed: errors.filter(e => e.status === "fixed").length,
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-sm text-muted-foreground">Total Errors</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-yellow-500">{stats.open}</div>
            <p className="text-sm text-muted-foreground">Open</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-500">{stats.fixed}</div>
            <p className="text-sm text-muted-foreground">Fixed</p>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Errors</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="fixed">Fixed</SelectItem>
            <SelectItem value="ignored">Ignored</SelectItem>
          </SelectContent>
        </Select>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Log Error
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Log AI Error</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Error Type</label>
                  <Select
                    value={newError.error_type}
                    onValueChange={(v) => setNewError({ ...newError, error_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hallucination">Hallucination</SelectItem>
                      <SelectItem value="wrong_response">Wrong Response</SelectItem>
                      <SelectItem value="tone_issue">Tone Issue</SelectItem>
                      <SelectItem value="missing_info">Missing Info</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Severity</label>
                  <Select
                    value={newError.severity}
                    onValueChange={(v) => setNewError({ ...newError, severity: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Customer Message</label>
                <Textarea
                  value={newError.original_message}
                  onChange={(e) => setNewError({ ...newError, original_message: e.target.value })}
                  placeholder="What did the customer say?"
                />
              </div>
              <div>
                <label className="text-sm font-medium">AI Response (Wrong)</label>
                <Textarea
                  value={newError.ai_response}
                  onChange={(e) => setNewError({ ...newError, ai_response: e.target.value })}
                  placeholder="What did the AI say incorrectly?"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Expected Response</label>
                <Textarea
                  value={newError.expected_response}
                  onChange={(e) => setNewError({ ...newError, expected_response: e.target.value })}
                  placeholder="What should the AI have said?"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
              <Button onClick={addError} disabled={!newError.original_message || !newError.ai_response}>
                Log Error
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Error List */}
      <Card>
        <CardHeader>
          <CardTitle>Error Log</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredErrors.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No errors logged yet</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {filteredErrors.map((error) => (
                  <div
                    key={error.id}
                    className="border rounded-lg p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedError(error)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(error.status)}
                        <Badge variant={getSeverityColor(error.severity)}>{error.severity}</Badge>
                        <Badge variant="outline">{error.error_type.replace("_", " ")}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(error.created_at), "MMM d, h:mm a")}
                      </span>
                    </div>
                    <p className="text-sm mt-2 line-clamp-2">{error.original_message}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Error Detail Dialog */}
      <Dialog open={!!selectedError} onOpenChange={() => setSelectedError(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedError && getStatusIcon(selectedError.status)}
              Error Details
            </DialogTitle>
          </DialogHeader>
          {selectedError && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Badge variant={getSeverityColor(selectedError.severity)}>{selectedError.severity}</Badge>
                <Badge variant="outline">{selectedError.error_type.replace("_", " ")}</Badge>
                <Badge variant="secondary">{selectedError.status}</Badge>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground">Customer Message</label>
                <p className="mt-1 p-3 bg-muted rounded-lg text-sm">{selectedError.original_message}</p>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground">AI Response (Wrong)</label>
                <p className="mt-1 p-3 bg-destructive/10 rounded-lg text-sm">{selectedError.ai_response}</p>
              </div>

              {selectedError.expected_response && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Expected Response</label>
                  <p className="mt-1 p-3 bg-green-500/10 rounded-lg text-sm">{selectedError.expected_response}</p>
                </div>
              )}

              {selectedError.fix_applied && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Fix Applied</label>
                  <p className="mt-1 p-3 bg-blue-500/10 rounded-lg text-sm">{selectedError.fix_applied}</p>
                </div>
              )}

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deleteError(selectedError.id)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
                {selectedError.status === "open" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatus(selectedError.id, "ignored")}
                    >
                      Mark Ignored
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => updateStatus(selectedError.id, "fixed", "Manual review and correction")}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Mark Fixed
                    </Button>
                  </>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
