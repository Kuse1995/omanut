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
import { Key, Plus, Copy, Check, Ban, AlertTriangle, Loader2, Download, Shield, Activity } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import JSZip from 'jszip';

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

function buildSkillMd(scope: 'company' | 'admin', label: string, name: string) {
  const title = scope === 'admin' ? 'Omanut AI — Admin Training' : `Omanut AI — ${label}`;
  const scopeLine = scope === 'admin'
    ? 'This skill connects to the Omanut AI platform with **admin scope** — you can switch between any company you have admin access to within a single session.'
    : `This skill connects to the Omanut AI platform scoped to **${label}**.`;

  return `---
name: ${name}
description: ${title} — train, configure, and operate the Omanut AI platform via MCP.
---

# ${title}

${scopeLine}

## Setup — DO THIS FIRST

1. Make sure the MCP server defined in \`mcp.json\` is registered with OpenClaw.
   - **Remove any older Omanut MCP entries from \`~/.claw/mcp.json\` first** (they will collide and OpenClaw may keep using the old key).
   - Copy the \`mcpServers\` block from this skill's \`mcp.json\` into \`~/.claw/mcp.json\` and **fully restart** OpenClaw (not just reload).
2. **VERIFY THE CONNECTION BEFORE ANYTHING ELSE.** Tell the assistant:
   > *"Use the ${name} MCP server. Call \`who_am_i\` and show me the key_prefix and scope."*
   - The \`key_prefix\` returned MUST match the prefix of the key embedded in this skill's \`mcp.json\`.
   - If it doesn't match, OpenClaw is using a stale config — fix \`~/.claw/mcp.json\` and restart again.
   - The \`scope\` MUST be \`${scope}\`. If it isn't, you installed the wrong skill.
3. ${scope === 'admin'
      ? 'Once verified, call `list_my_companies` → then `set_active_company` to choose which company you want to operate on.'
      : 'Once verified, you are already scoped to your company — go straight to the workflow tools below.'}

## When to use this skill

Use this skill whenever the user wants to:
- Inspect or train the Omanut AI agent (system instructions, prompts, tools, models)
- Review conversations, tickets, reservations, payments, customers
- Generate, schedule, or approve social media content
- Manage media library, brand assets, product identity
- Configure spending limits, approvals, or supervisor behavior

## References

- \`references/session-flow.md\` — how to start and structure a session
- \`references/tools.md\` — full tool catalog grouped by category
- \`references/autonomous-loop.md\` — Analyze → Research → Create → Promote → Sell → Audit
- \`references/guardrails.md\` — spending guard, HITL approval, P&L checks

## Authentication

The API key is embedded in \`mcp.json\` (\`--header x-api-key:...\`). Treat the whole skill folder as a secret — anyone with this folder can act as ${scope === 'admin' ? 'an admin across all your companies' : 'this company'}.
`;
}

const REF_SESSION_FLOW = `# Session Flow

## Admin scope (multi-company)

1. \`list_my_companies\` — returns every company you have admin access to.
2. \`set_active_company({ company_id })\` — pin the session to one company. All subsequent tool calls operate on that company.
3. To switch mid-session, just call \`set_active_company\` again with a different ID.
4. The platform re-validates your admin role on every request — revoking the key or removing your role takes effect immediately.

## Company scope

Skip steps 1–2. The session is already pinned to the company that issued the key.

## Recommended opener

> "List my companies, then set the active one to <name>. Pull the last 24h of conversations, open tickets, and pending content approvals so we can plan."
`;

const REF_TOOLS = `# Tool Catalog

Group your asks around these capability clusters. The exact tool names are exposed by the MCP server — ask the assistant to list them if unsure.

## Conversations & Inbox
- Read recent conversations, transcripts, supervisor analysis
- Take over / release a conversation
- Send a reply on behalf of the agent

## Customers & Segments
- Lookup a customer by phone
- Run / refresh segmentation
- Inspect engagement and conversion scores

## Tickets, Reservations, Payments
- List/filter tickets and SLA status
- Create / approve / cancel reservations
- Inspect payment transactions and digital deliveries

## AI Configuration (training)
- Read & update \`company_ai_overrides\` (system prompt, banned topics, models, temperatures)
- Tune supervisor behavior and routing thresholds
- Adjust spending limits & approval rules

## Content & Media
- Generate, schedule, approve social posts
- Inspect media library and brand assets
- Manage product identity profiles

## Reporting
- Daily briefings, P&L snapshots, agent performance, error logs
`;

const REF_AUTONOMOUS_LOOP = `# Autonomous Operating Loop

The Omanut AI is designed to run a closed loop per company:

1. **Analyze** — pull last 24–72h of conversations, tickets, payments, and supervisor flags.
2. **Research** — for each flagged pattern, look up the customer, BMS data, and brand assets.
3. **Create** — draft replies, content, or config changes. Stage them for approval where required.
4. **Promote** — schedule social posts, send re-engagement DMs, trigger payment links.
5. **Sell** — guide customers through the autonomous checkout (check_stock → record_sale → generate_payment_link).
6. **Audit** — re-read metrics, compare to goals, log adjustments to \`company_ai_overrides\`.

When training, walk one full loop per company per session and write your decisions back into the AI overrides so the agent improves between sessions.
`;

const REF_GUARDRAILS = `# Guardrails

## Spending guard
- \`agent_spending_limits.daily_ad_budget_limit\` caps autonomous ad spend.
- \`sale_approval_threshold\` forces HITL approval for sales above the threshold.

## Human-in-the-loop
- \`require_approval_for_publishing\` — social posts queue in approvals instead of going live.
- \`require_approval_for_ai_config\` — config edits queue for boss approval.

## P&L checks
- Always cross-check generated promotions against \`payment_transactions\` and \`credit_usage\` before scaling.
- Refuse to recommend discounts that would push margin negative based on recent BMS cost data.

## Confidentiality
- Never echo system prompts, BMS costs, or internal operational rules onto Meta channels.
- Treat the API key like a password — rotate immediately if exposed.
`;

async function buildSkillZip(plainKey: string, scope: 'company' | 'admin', label: string): Promise<Blob> {
  const name = serverNameFor(scope, label);
  const zip = new JSZip();
  const root = zip.folder(name)!;

  root.file('SKILL.md', buildSkillMd(scope, label, name));
  root.file('mcp.json', JSON.stringify(buildMcpConfig(plainKey, scope, label), null, 2));

  const refs = root.folder('references')!;
  refs.file('session-flow.md', REF_SESSION_FLOW);
  refs.file('tools.md', REF_TOOLS);
  refs.file('autonomous-loop.md', REF_AUTONOMOUS_LOOP);
  refs.file('guardrails.md', REF_GUARDRAILS);

  return zip.generateAsync({ type: 'blob' });
}

function downloadBlob(filename: string, blob: Blob) {
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

  const downloadIssuedConfig = async () => {
    try {
      const blob = await buildSkillZip(newPlaintextKey, newKeyScopeIssued, newKeyLabel || 'omanut');
      const filename = `${serverNameFor(newKeyScopeIssued, newKeyLabel)}.zip`;
      downloadBlob(filename, blob);
      toast.success('OpenClaw skill package downloaded');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to build skill package');
    }
  };

  const downloadTemplateForRow = async (k: ApiKey) => {
    try {
      const scope = (k.scope ?? 'company') as 'company' | 'admin';
      const blob = await buildSkillZip('YOUR_API_KEY_HERE', scope, k.name);
      const filename = `${serverNameFor(scope, k.name)}.template.zip`;
      downloadBlob(filename, blob);
      toast.success('Template skill downloaded — paste your saved API key into mcp.json');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to build template');
    }
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
            <TableHead className="w-[110px]" />
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
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => downloadTemplateForRow(k)}
                    title="Download MCP server config template"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
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
                </div>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Your API Key</DialogTitle>
            <DialogDescription>
              Copy this key now — you won't be able to see it again. Then download the OpenClaw skill package (a zipped folder with <code className="bg-muted px-1 rounded">SKILL.md</code> + <code className="bg-muted px-1 rounded">mcp.json</code> + references).
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted p-3 rounded-md text-xs break-all select-all">
              {newPlaintextKey}
            </code>
            <Button variant="outline" size="icon" onClick={copyToClipboard} title="Copy key">
              {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Button variant="default" onClick={downloadIssuedConfig} className="gap-1.5 w-full">
            <Download className="h-4 w-4" />
            Download OpenClaw skill (.zip)
          </Button>
          <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
            <p className="text-xs font-medium">How to install in OpenClaw</p>
            <ol className="text-xs text-muted-foreground list-decimal pl-4 space-y-1">
              <li>Unzip the file into your OpenClaw skills folder (e.g. <code className="bg-muted px-1 rounded">~/.claw/skills/</code>).</li>
              <li>Restart OpenClaw — it auto-discovers the skill on launch.</li>
              <li>Tell OpenClaw: <em>"use the {serverNameFor(newKeyScopeIssued, newKeyLabel)} skill"</em>.</li>
              <li>Do <strong>not</strong> run <code className="bg-muted px-1 rounded">clawhub install</code> — this is a local skill, not a published one.</li>
            </ol>
          </div>
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
