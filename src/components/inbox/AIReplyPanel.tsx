import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Loader2, Sparkles, Check, X, Send, Edit2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanyRole } from '@/hooks/useCompanyRole';

interface ReplyDraft {
  id: string;
  source_type: string;
  source_id: string;
  ai_reply: string;
  status: string;
  created_at: string;
}

interface AIReplyPanelProps {
  sourceType: 'facebook_message' | 'facebook_comment';
  sourceId: string;
  companyId: string;
  originalContent: string;
  senderName: string;
  existingDraft?: ReplyDraft;
  onDraftUpdated: () => void;
}

export function AIReplyPanel({
  sourceType,
  sourceId,
  companyId,
  originalContent,
  senderName,
  existingDraft,
  onDraftUpdated,
}: AIReplyPanelProps) {
  const { isManager, isOwner } = useCompanyRole();
  const canApprove = isManager || isOwner;
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedReply, setEditedReply] = useState(existingDraft?.ai_reply || '');

  const generateDraft = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-reply-draft', {
        body: {
          source_type: sourceType,
          source_id: sourceId,
          company_id: companyId,
        },
      });

      if (error) throw error;
      
      toast.success('AI draft generated successfully');
      onDraftUpdated();
    } catch (error) {
      console.error('Error generating draft:', error);
      toast.error('Failed to generate AI draft');
    } finally {
      setIsGenerating(false);
    }
  };

  const approveDraft = async () => {
    if (!existingDraft) return;
    
    setIsApproving(true);
    try {
      const { error } = await supabase
        .from('message_reply_drafts')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          ai_reply: isEditing ? editedReply : existingDraft.ai_reply,
        })
        .eq('id', existingDraft.id);

      if (error) throw error;
      
      setIsEditing(false);
      toast.success('Draft approved');
      onDraftUpdated();
    } catch (error) {
      console.error('Error approving draft:', error);
      toast.error('Failed to approve draft');
    } finally {
      setIsApproving(false);
    }
  };

  const rejectDraft = async (reason?: string) => {
    if (!existingDraft) return;
    
    try {
      const { error } = await supabase
        .from('message_reply_drafts')
        .update({
          status: 'rejected',
          rejected_at: new Date().toISOString(),
          rejection_reason: reason || 'Rejected by user',
        })
        .eq('id', existingDraft.id);

      if (error) throw error;
      
      toast.success('Draft rejected');
      onDraftUpdated();
    } catch (error) {
      console.error('Error rejecting draft:', error);
      toast.error('Failed to reject draft');
    }
  };

  const sendReply = async () => {
    if (!existingDraft || existingDraft.status !== 'approved') {
      toast.error('Draft must be approved before sending');
      return;
    }
    
    setIsSending(true);
    try {
      const endpoint = sourceType === 'facebook_message' 
        ? 'send-facebook-message-reply' 
        : 'send-facebook-comment-reply';
      
      const { data, error } = await supabase.functions.invoke(endpoint, {
        body: { draft_id: existingDraft.id },
      });

      if (error) throw error;
      
      toast.success('Reply sent successfully');
      onDraftUpdated();
    } catch (error) {
      console.error('Error sending reply:', error);
      toast.error('Failed to send reply');
    } finally {
      setIsSending(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'secondary';
      case 'approved': return 'default';
      case 'sent': return 'default';
      case 'rejected': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <div className="space-y-4">
      {/* Original message */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Original {sourceType === 'facebook_message' ? 'Message' : 'Comment'}
        </p>
        <div className="rounded-lg bg-muted p-3">
          <p className="text-sm font-medium mb-1">{senderName}</p>
          <p className="text-sm text-muted-foreground">{originalContent || '[No text content]'}</p>
        </div>
      </div>

      <Separator />

      {/* Draft section */}
      {existingDraft ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              AI Generated Reply
            </p>
            <Badge variant={getStatusColor(existingDraft.status) as any}>
              {existingDraft.status.charAt(0).toUpperCase() + existingDraft.status.slice(1)}
            </Badge>
          </div>
          
          {isEditing ? (
            <Textarea
              value={editedReply}
              onChange={(e) => setEditedReply(e.target.value)}
              className="min-h-[120px]"
              placeholder="Edit the reply..."
            />
          ) : (
            <div className="rounded-lg border p-3 bg-background">
              <p className="text-sm whitespace-pre-wrap">{existingDraft.ai_reply}</p>
            </div>
          )}

          {/* Action buttons based on status */}
          <div className="flex flex-wrap gap-2">
            {existingDraft.status === 'draft' && (
              <>
                {!isEditing ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditedReply(existingDraft.ai_reply);
                      setIsEditing(true);
                    }}
                  >
                    <Edit2 className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(false)}
                  >
                    Cancel
                  </Button>
                )}
                
                {canApprove && (
                  <>
                    <Button
                      size="sm"
                      onClick={approveDraft}
                      disabled={isApproving}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {isApproving ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4 mr-1" />
                      )}
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => rejectDraft()}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </>
                )}
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateDraft}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-1" />
                  )}
                  Regenerate
                </Button>
              </>
            )}

            {existingDraft.status === 'approved' && canApprove && (
              <Button
                size="sm"
                onClick={sendReply}
                disabled={isSending}
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1" />
                )}
                Send Reply
              </Button>
            )}

            {existingDraft.status === 'sent' && (
              <p className="text-sm text-green-600">✓ Reply has been sent</p>
            )}

            {existingDraft.status === 'rejected' && (
              <Button
                variant="outline"
                size="sm"
                onClick={generateDraft}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-1" />
                )}
                Generate New Draft
              </Button>
            )}
          </div>
          
          {!canApprove && existingDraft.status === 'draft' && (
            <p className="text-xs text-muted-foreground">
              Manager or Owner role required to approve and send replies.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            No draft exists for this {sourceType === 'facebook_message' ? 'message' : 'comment'}.
          </p>
          <Button
            onClick={generateDraft}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Generate AI Reply
          </Button>
        </div>
      )}
    </div>
  );
}
