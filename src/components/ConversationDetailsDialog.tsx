import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Phone, MessageSquare, Clock, Calendar, User, AlertCircle, Info, Star } from 'lucide-react';

interface ConversationDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: any;
  clientInfo: any[];
  actionItems: any[];
}

export default function ConversationDetailsDialog({
  open,
  onOpenChange,
  conversation,
  clientInfo,
  actionItems
}: ConversationDetailsDialogProps) {
  if (!conversation) return null;

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'urgent': return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'high': return <AlertCircle className="h-4 w-4 text-orange-500" />;
      case 'medium': return <Info className="h-4 w-4 text-accent-lime" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getImportanceIcon = (importance: string) => {
    switch (importance) {
      case 'high': return <Star className="h-4 w-4 text-accent-gold fill-accent-gold" />;
      default: return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden card-glass">
        <DialogHeader>
          <DialogTitle className="text-2xl text-gradient">Conversation Details</DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[calc(90vh-100px)] pr-4">
          <div className="space-y-6">
            {/* Basic Info */}
            <Card className="card-glass">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Customer Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Name</div>
                    <div className="font-medium">{conversation.customer_name || 'Unknown'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Phone</div>
                    <div className="font-medium flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      {conversation.phone || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Started</div>
                    <div className="font-medium flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      {new Date(conversation.started_at).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Duration</div>
                    <div className="font-medium flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      {conversation.duration_seconds ? `${conversation.duration_seconds}s` : 'N/A'}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Status</div>
                  <Badge variant={conversation.status === 'active' ? 'default' : 'secondary'}>
                    {conversation.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Transcript */}
            {conversation.transcript && (
              <Card className="card-glass">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    Conversation Transcript
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-64 w-full rounded-md border border-border p-4 bg-bg-card">
                    <pre className="whitespace-pre-wrap text-sm font-mono text-text-primary">
                      {conversation.transcript}
                    </pre>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Client Information Extracted */}
            {clientInfo.length > 0 && (
              <Card className="card-glass">
                <CardHeader>
                  <CardTitle>Client Information Extracted</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Importance</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Information</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientInfo.map((info) => (
                        <TableRow key={info.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getImportanceIcon(info.importance)}
                              <span className="capitalize">{info.importance}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {info.info_type.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell>{info.information}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Action Items */}
            {actionItems.length > 0 && (
              <Card className="card-glass">
                <CardHeader>
                  <CardTitle>Action Items Created</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Priority</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {actionItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getPriorityIcon(item.priority)}
                              <span className="capitalize">{item.priority}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {item.action_type.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell>{item.description}</TableCell>
                          <TableCell>
                            <Badge variant={
                              item.status === 'completed' ? 'default' :
                              item.status === 'in_progress' ? 'secondary' :
                              'outline'
                            }>
                              {item.status.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {clientInfo.length === 0 && actionItems.length === 0 && (
              <Card className="card-glass">
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Info className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No client insights or action items extracted yet.</p>
                  <p className="text-sm mt-2">The AI automatically analyzes completed conversations.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
