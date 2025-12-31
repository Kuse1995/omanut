import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanyRole } from '@/hooks/useCompanyRole';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { 
  Image, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Eye,
  RefreshCw,
  Loader2,
  Sparkles,
  AlertTriangle,
  Send
} from 'lucide-react';

type ImageStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';

interface GeneratedImage {
  id: string;
  prompt: string;
  image_url: string;
  status: ImageStatus;
  created_at: string;
  approved_by?: string;
  approved_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  rejection_reason?: string;
  brand_assets_used?: string[];
  generation_params?: Record<string, unknown>;
}

interface DraftImageApprovalProps {
  companyId: string;
  images: GeneratedImage[];
  onImagesChange: () => void;
}

const statusConfig: Record<ImageStatus, { label: string; icon: React.ReactNode; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Draft', icon: <Clock className="h-3 w-3" />, variant: 'secondary' },
  pending_approval: { label: 'Pending', icon: <Send className="h-3 w-3" />, variant: 'outline' },
  approved: { label: 'Approved', icon: <CheckCircle2 className="h-3 w-3" />, variant: 'default' },
  rejected: { label: 'Rejected', icon: <XCircle className="h-3 w-3" />, variant: 'destructive' }
};

export const DraftImageApproval = ({ companyId, images, onImagesChange }: DraftImageApprovalProps) => {
  const { isOwner, isManager } = useCompanyRole();
  const canApprove = isOwner || isManager;
  
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ImageStatus | 'all'>('all');

  const filteredImages = statusFilter === 'all' 
    ? images 
    : images.filter(img => img.status === statusFilter);

  const countByStatus = (status: ImageStatus) => images.filter(img => img.status === status).length;

  const handleSubmitForApproval = async (image: GeneratedImage) => {
    setProcessing(true);
    try {
      const { error } = await supabase
        .from('generated_images')
        .update({ status: 'pending_approval' })
        .eq('id', image.id)
        .eq('company_id', companyId);

      if (error) throw error;
      toast.success('Submitted for approval');
      onImagesChange();
    } catch (error) {
      console.error('Error submitting for approval:', error);
      toast.error('Failed to submit for approval');
    } finally {
      setProcessing(false);
    }
  };

  const handleApprove = async (image: GeneratedImage) => {
    if (!canApprove) {
      toast.error('Only owners or managers can approve images');
      return;
    }

    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('generated_images')
        .update({ 
          status: 'approved',
          approved_by: user?.id,
          approved_at: new Date().toISOString()
        })
        .eq('id', image.id)
        .eq('company_id', companyId);

      if (error) throw error;
      toast.success('Image approved');
      setSelectedImage(null);
      onImagesChange();
    } catch (error) {
      console.error('Error approving image:', error);
      toast.error('Failed to approve image');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!canApprove || !selectedImage) return;

    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('generated_images')
        .update({ 
          status: 'rejected',
          rejected_by: user?.id,
          rejected_at: new Date().toISOString(),
          rejection_reason: rejectionReason || 'No reason provided'
        })
        .eq('id', selectedImage.id)
        .eq('company_id', companyId);

      if (error) throw error;
      toast.success('Image rejected');
      setSelectedImage(null);
      setShowRejectDialog(false);
      setRejectionReason('');
      onImagesChange();
    } catch (error) {
      console.error('Error rejecting image:', error);
      toast.error('Failed to reject image');
    } finally {
      setProcessing(false);
    }
  };

  const handleRegenerate = async (image: GeneratedImage) => {
    setRegenerating(image.id);
    try {
      const params = image.generation_params as Record<string, unknown> | undefined;
      const originalPrompt = params?.original_prompt as string || image.prompt;
      const productId = params?.product_id as string | undefined;

      const { data, error } = await supabase.functions.invoke('test-image-generation', {
        body: {
          companyId,
          prompt: originalPrompt,
          productImageId: productId,
          useProductMode: !!productId
        }
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast.success('New draft generated');
      onImagesChange();
    } catch (error) {
      console.error('Error regenerating:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to regenerate');
    } finally {
      setRegenerating(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Draft Images & Approvals
        </CardTitle>
        <CardDescription>
          Review and approve AI-generated images before publishing
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Filter */}
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={statusFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('all')}
          >
            All ({images.length})
          </Button>
          {(Object.keys(statusConfig) as ImageStatus[]).map((status) => {
            const config = statusConfig[status];
            const count = countByStatus(status);
            return (
              <Button
                key={status}
                variant={statusFilter === status ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(status)}
                className="gap-1"
              >
                {config.icon}
                {config.label} ({count})
              </Button>
            );
          })}
        </div>

        {/* Image Grid */}
        {filteredImages.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Image className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No {statusFilter === 'all' ? '' : statusFilter.replace('_', ' ')} images</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredImages.map((image) => {
                const config = statusConfig[image.status];
                return (
                  <div
                    key={image.id}
                    className="group relative aspect-square rounded-lg overflow-hidden border bg-muted cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                    onClick={() => setSelectedImage(image)}
                  >
                    <img
                      src={image.image_url}
                      alt={image.prompt}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    
                    {/* Status Badge */}
                    <Badge 
                      variant={config.variant}
                      className="absolute top-2 left-2 gap-1"
                    >
                      {config.icon}
                      {config.label}
                    </Badge>

                    {/* Regenerating Overlay */}
                    {regenerating === image.id && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-white" />
                      </div>
                    )}

                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                      <p className="text-white text-xs line-clamp-2">{image.prompt}</p>
                    </div>

                    {/* View Button */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="icon" variant="secondary" className="h-7 w-7">
                        <Eye className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>

      {/* Image Detail Dialog */}
      <Dialog open={!!selectedImage && !showRejectDialog} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Image Details
              {selectedImage && (
                <Badge variant={statusConfig[selectedImage.status].variant} className="gap-1">
                  {statusConfig[selectedImage.status].icon}
                  {statusConfig[selectedImage.status].label}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {selectedImage && (
            <div className="space-y-4">
              <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                <img
                  src={selectedImage.image_url}
                  alt={selectedImage.prompt}
                  className="w-full h-full object-contain"
                />
              </div>
              
              <div className="space-y-2">
                <Label className="text-sm font-medium">Prompt</Label>
                <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                  {selectedImage.prompt}
                </p>
              </div>

              {selectedImage.rejection_reason && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Rejection Reason</p>
                    <p className="text-sm">{selectedImage.rejection_reason}</p>
                  </div>
                </div>
              )}

              <div className="text-sm text-muted-foreground">
                Created: {new Date(selectedImage.created_at).toLocaleString()}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 flex-wrap">
            {/* Draft actions */}
            {selectedImage?.status === 'draft' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => selectedImage && handleRegenerate(selectedImage)}
                  disabled={!!regenerating}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate
                </Button>
                <Button
                  onClick={() => selectedImage && handleSubmitForApproval(selectedImage)}
                  disabled={processing}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Submit for Approval
                </Button>
              </>
            )}

            {/* Pending approval actions (managers/owners only) */}
            {selectedImage?.status === 'pending_approval' && canApprove && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowRejectDialog(true)}
                  disabled={processing}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
                <Button
                  onClick={() => selectedImage && handleApprove(selectedImage)}
                  disabled={processing}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {processing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  Approve
                </Button>
              </>
            )}

            {/* Rejected - can regenerate */}
            {selectedImage?.status === 'rejected' && (
              <Button
                variant="outline"
                onClick={() => selectedImage && handleRegenerate(selectedImage)}
                disabled={!!regenerating}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate Draft
              </Button>
            )}

            {/* Cannot approve message */}
            {selectedImage?.status === 'pending_approval' && !canApprove && (
              <p className="text-sm text-muted-foreground">
                Only owners or managers can approve images
              </p>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Image</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this image
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Rejection Reason</Label>
              <Textarea
                id="reason"
                placeholder="e.g., Image doesn't match brand guidelines..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleReject}
              disabled={processing}
            >
              {processing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Reject Image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
