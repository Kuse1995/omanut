import { useState, useEffect, useCallback } from 'react';
import { useCompany } from '@/context/CompanyContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Key, Plus, Copy, Check, Ban, AlertTriangle, Loader2, Download, Shield } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface ApiKey {
  id: string;
  key_prefix: string;
  name: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  expires_at: string | null;
  scope?: 'company' | 'admin';
  company_id?: string | null;
}

const MCP_URL = 'https://dzheddvoiauevcayifev.supabase.co/functions/v1/mcp-server';

function serverNameFor(scope: 'company' | 'admin', label: string) {
  if (scope === 'admin') return 'omanut-ai-admin';
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24).replace(/^-+|-+$/g, '') || 'company';
  return `omanut-ai-${slug}`;
}

function buildMcpConfig(plainKey: string, scope: 'company' | 'admin', label: string) {
  const name = serverNameFor(scope, label);
  return {
    mcpServers: {
      [name]: {
        command: 'npx',
        args: ['-y', 'mcp-remote', MCP_URL, '--header', `x-api-key:${plainKey}`],
      },
    },
  };
}

function downloadJsonFile(filename: string, content: object) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ApiKeysSection = () => {
  const { selectedCompany } = useCompany();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [adminKeys, setAdminKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScope, setNewKeyScope] = useState<'company' | 'admin'>('company');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [newPlaintextKey, setNewPlaintextKey] = useState('');
  const [newKeyScopeIssued, setNewKeyScopeIssued] = useState<'company' | 'admin'>('company');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [copied, setCopied] = useState(false);
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const [revokeKeyScope, setRevokeKeyScope] = useState<'company' | 'admin'>('company');
  const [revoking, setRevoking] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Detect admin role
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .eq('role', 'admin')
        .maybeSingle();
      setIsAdmin(!!data);
    })();
  }, []);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const reqs: Promise<any>[] = [];
      if (selectedCompany) {
        reqs.push(
          supabase.functions.invoke('manage-api-keys', {
            body: { action: 'list', company_id: selectedCompany.id },
          })
        );
      } else {
        reqs.push(Promise.resolve({ data: { keys: [] } }));
      }
      if (isAdmin) {
        reqs.push(
          supabase.functions.invoke('manage-api-keys', {
            body: { action: 'list' }, // no company_id → admin scope listing
          })
        );
      } else {
        reqs.push(Promise.resolve({ data: { keys: [] } }));
      }

      const [companyRes, adminRes] = await Promise.all(reqs);
      setKeys(companyRes.data?.keys?.filter((k: ApiKey) => (k.scope ?? 'company') === 'company') || []);
      setAdminKeys(adminRes.data?.keys?.filter((k: ApiKey) => k.scope === 'admin') || []);
    } catch (err: any) {
      console.error('Failed to load API keys:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, isAdmin]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    if (newKeyScope === 'company' && !selectedCompany) return;
    setCreating(true);
    try {
      const body: any = {
        action: 'create',
        name: newKeyName.trim(),
        scope: newKeyScope,
      };
      if (newKeyScope === 'company') body.company_id = selectedCompany!.id;

      const { data, error } = await supabase.functions.invoke('manage-api-keys', { body });
      if (error) throw error;
      setNewPlaintextKey(data.key);
      setNewKeyScopeIssued(newKeyScope);
      setNewKeyLabel(newKeyName.trim());
      setShowCreateDialog(false);
      setShowKeyDialog(true);
      setNewKeyName('');
      setNewKeyScope('company');
      fetchKeys();
      toast.success('API key created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeKeyId) return;
    setRevoking(true);
    try {
      const body: any = { action: 'revoke', key_id: revokeKeyId };
      if (revokeKeyScope === 'company' && selectedCompany) body.company_id = selectedCompany.id;
      const { error } = await supabase.functions.invoke('manage-api-keys', { body });
      if (error) throw error;
      toast.success('API key revoked');
      setRevokeKeyId(null);
      fetchKeys();
    } catch (err: any) {
      toast.error(err.message || 'Failed to revoke key');
    } finally {
      setRevoking(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(newPlaintextKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadIssuedSkill = () => {
    const skill = buildSkillJson(newPlaintextKey, newKeyScopeIssued, newKeyLabel || 'omanut');
    const filename = newKeyScopeIssued === 'admin' ? 'omanut-ai-admin.json' : `omanut-ai-${newKeyLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'company'}.json`;
    downloadSkillFile(filename, skill);
    toast.success('Skill file downloaded');
  };

  const renderKeyTable = (
    rows: ApiKey[],
    scope: 'company' | 'admin'
  ) => (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Used</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-[80px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((k) => (
            <TableRow key={k.id}>
              <TableCell className="font-medium">{k.name}</TableCell>
              <TableCell>
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                  {k.key_prefix}...
                </code>
              </TableCell>
              <TableCell>
                {(k.scope ?? 'company') === 'admin' ? (
                  <Badge variant="outline" className="text-xs gap-1 border-primary/50 text-primary">
                    <Shield className="h-3 w-3" />
                    Admin — All Companies
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Company</Badge>
                )}
              </TableCell>
              <TableCell>
                {k.is_active ? (
                  <Badge variant="default" className="text-xs">Active</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Revoked</Badge>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {k.last_used_at
                  ? formatDistanceToNow(new Date(k.last_used_at), { addSuffix: true })
                  : 'Never'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(k.created_at), { addSuffix: true })}
              </TableCell>
              <TableCell>
                {k.is_active && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => { setRevokeKeyId(k.id); setRevokeKeyScope(scope); }}
                    title="Revoke key"
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  if (!selectedCompany && !isAdmin) return null;

  return (
    <div className="space-y-6">
      {/* Company-scoped keys */}
      {selectedCompany && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold">API Keys — {selectedCompany.name}</h3>
            </div>
            <Button size="sm" onClick={() => { setNewKeyScope('company'); setShowCreateDialog(true); }} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Generate Key
            </Button>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                API keys grant <strong>full access</strong> to this company's data. Treat them like passwords.
                Keys are shown only once at creation — store them securely.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No API keys yet for this company.
            </div>
          ) : (
            renderKeyTable(keys, 'company')
          )}
        </div>
      )}

      {/* Admin-scoped (multi-company training) keys */}
      {isAdmin && (
        <>
          {selectedCompany && <Separator />}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">Admin Training Keys</h3>
              </div>
              <Button
                size="sm"
                variant="default"
                onClick={() => { setNewKeyScope('admin'); setNewKeyName('OpenClaw Training'); setShowCreateDialog(true); }}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Generate Admin Training Key
              </Button>
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Admin training keys can target <strong>any company</strong> in one OpenClaw session.
                  Use <code className="bg-muted px-1 py-0.5 rounded text-[11px]">list_my_companies</code> →{' '}
                  <code className="bg-muted px-1 py-0.5 rounded text-[11px]">set_active_company</code> to switch
                  between companies mid-session. The key is re-validated against your admin role on every request.
                </p>
              </div>
            </div>

            {loading ? null : adminKeys.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No admin training keys yet. Generate one to train the AI across all your companies in a single OpenClaw session.
              </div>
            ) : (
              renderKeyTable(adminKeys, 'admin')
            )}
          </div>
        </>
      )}

      {/* Create Key Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {newKeyScope === 'admin' ? 'Generate Admin Training Key' : 'Generate API Key'}
            </DialogTitle>
            <DialogDescription>
              {newKeyScope === 'admin'
                ? 'This key will let one OpenClaw session train any company you have admin access to.'
                : `This key will grant full programmatic access to ${selectedCompany?.name}'s data.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Key Name</label>
            <Input
              placeholder={newKeyScope === 'admin' ? 'OpenClaw Training' : 'e.g. Production Agent'}
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newKeyName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show Key Dialog (one-time) */}
      <Dialog open={showKeyDialog} onOpenChange={(open) => { if (!open) setShowKeyDialog(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your API Key</DialogTitle>
            <DialogDescription>
              Copy this key now. You won't be able to see it again. Or download a ready-to-use OpenClaw skill file with the key pre-filled.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted p-3 rounded-md text-xs break-all select-all">
              {newPlaintextKey}
            </code>
            <Button variant="outline" size="icon" onClick={copyToClipboard} title="Copy key">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Button variant="outline" onClick={downloadIssuedSkill} className="gap-1.5 w-full">
            <Download className="h-4 w-4" />
            Download OpenClaw skill file
          </Button>
          <DialogFooter>
            <Button onClick={() => setShowKeyDialog(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation */}
      <AlertDialog open={!!revokeKeyId} onOpenChange={(open) => { if (!open) setRevokeKeyId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              Any agents using this key will immediately lose access. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              disabled={revoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revoking ? 'Revoking...' : 'Revoke Key'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
