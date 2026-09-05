import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Megaphone, Rocket, Palette, RefreshCw, ArrowLeft, Loader2, Trophy, TrendingUp, Users, MessageSquare, Video, FileText, Settings, CheckCircle2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/context/CompanyContext";

const PLAYBOOKS = [
  { key: "flash_sale", label: "Flash Sale", objective: "Urgency + sales" },
  { key: "launch", label: "Product Launch", objective: "Awareness + first orders" },
  { key: "restock", label: "Restock Alert", objective: "Convert waiting customers" },
  { key: "seasonal", label: "Seasonal / Holiday", objective: "Timely relevance" },
  { key: "new_branch", label: "New Branch", objective: "Local awareness" },
  { key: "awareness", label: "Brand Awareness", objective: "Reach + recall" },
];

const Growth = () => {
  const navigate = useNavigate();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id || null;

  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<any>(null);
  const [summary, setSummary] = useState("");
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sequences, setSequences] = useState<any[]>([]);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [insight, setInsight] = useState("");

  // Campaign composer
  const [brief, setBrief] = useState("");
  const [playbook, setPlaybook] = useState("flash_sale");
  const [campaignName, setCampaignName] = useState("");
  const [launching, setLaunching] = useState(false);

  // Brand kit
  const [brand, setBrand] = useState<any>({ tone: "", colors: "", no_go_phrases: "", guidelines: "" });
  const [savingBrand, setSavingBrand] = useState(false);

  // Sequences
  const [seqName, setSeqName] = useState("");
  const [seqMessage, setSeqMessage] = useState("");
  const [seqDelay, setSeqDelay] = useState(1);
  const [seqType, setSeqType] = useState("abandoned_enquiry");
  const [addingSeq, setAddingSeq] = useState(false);

  // Competitors
  const [compName, setCompName] = useState("");
  const [compPlatform, setCompPlatform] = useState("facebook");
  const [addingComp, setAddingComp] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [hub, camps, seqs, comps] = await Promise.all([
        supabase.functions.invoke("growth-hub", { body: { action: "summary", company_id: companyId } }),
        supabase.functions.invoke("campaign-engine", { body: { action: "list", company_id: companyId } }),
        supabase.functions.invoke("lead-nurture", { body: { action: "list", company_id: companyId } }),
        supabase.functions.invoke("competitor-watch", { body: { action: "list", company_id: companyId } }),
      ]);
      setMetrics(hub.data?.metrics || null);
      setSummary(hub.data?.summary || "");
      setCampaigns(camps.data?.campaigns || []);
      setSequences(seqs.data?.sequences || []);
      setCompetitors(comps.data?.targets || []);

      const ins = await supabase.functions.invoke("competitor-watch", { body: { action: "insight", company_id: companyId } });
      setInsight(ins.data?.insight || "");
      const opt = await supabase.functions.invoke("optimize-posting", { body: { company_id: companyId } });
      if (opt.data?.insights) setMetrics((prev: any) => ({ ...(prev || {}), optimize: opt.data.insights }));
    } catch (e) {
      console.error("Growth refresh failed:", e);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { refresh(); }, [companyId]);

  const loadBrand = async () => {
    if (!companyId) return;
    const { data } = await supabase.from("brand_kits").select("*").eq("company_id", companyId).maybeSingle();
    if (data) setBrand({
      tone: data.tone || "", colors: JSON.stringify(data.colors || {}, null, 0), no_go_phrases: data.no_go_phrases || "", guidelines: data.guidelines || "",
    });
  };
  useEffect(() => { loadBrand(); }, [companyId]);

  const launchCampaign = async () => {
    if (!companyId || !brief.trim()) return;
    setLaunching(true);
    try {
      const { data } = await supabase.functions.invoke("campaign-engine", {
        body: { action: "create", company_id: companyId, brief: brief.trim(), playbook, name: campaignName, variant_count: 3, channels: ["facebook", "instagram"] },
      });
      if (data?.success) {
        setBrief(""); setCampaignName("");
        await refresh();
      }
    } catch (e) { console.error(e); }
    finally { setLaunching(false); }
  };

  const saveBrandKit = async () => {
    if (!companyId) return;
    setSavingBrand(true);
    try {
      const payload = { tone: brand.tone, no_go_phrases: brand.no_go_phrases, guidelines: brand.guidelines };
      let colors: any = brand.colors ? null : {};
      if (brand.colors) { try { colors = JSON.parse(brand.colors); } catch { colors = { primary: brand.colors }; } }
      const { data: existing } = await supabase.from("brand_kits").select("id").eq("company_id", companyId).maybeSingle();
      if (existing?.id) await supabase.from("brand_kits").update({ ...payload, colors, updated_at: new Date().toISOString() }).eq("id", existing.id);
      else await supabase.from("brand_kits").insert({ company_id: companyId, ...payload, colors });
    } catch (e) { console.error(e); }
    finally { setSavingBrand(false); }
  };

  const addSequence = async () => {
    if (!companyId || !seqMessage.trim()) return;
    setAddingSeq(true);
    try {
      const { data } = await supabase.functions.invoke("lead-nurture", {
        body: { action: "create", company_id: companyId, name: seqName || seqType, trigger_type: seqType, steps: [{ delay_days: seqDelay, channel: "facebook", message: seqMessage.trim() }] },
      });
      if (data?.success) { setSeqName(""); setSeqMessage(""); setSeqDelay(1); await refresh(); }
    } catch (e) { console.error(e); }
    finally { setAddingSeq(false); }
  };

  const armSequence = async (id: string) => {
    if (!companyId) return;
    await supabase.functions.invoke("lead-nurture", { body: { action: "arm", company_id: companyId, sequence_id: id } });
    await refresh();
  };

  const addCompetitor = async () => {
    if (!companyId || !compName.trim()) return;
    setAddingComp(true);
    try {
      const { data } = await supabase.functions.invoke("competitor-watch", { body: { action: "add", company_id: companyId, name: compName.trim(), platform: compPlatform } });
      if (data?.success) { setCompName(""); await refresh(); }
    } catch (e) { console.error(e); }
    finally { setAddingComp(false); }
  };

  const removeCompetitor = async (id: string) => {
    if (!companyId) return;
    await supabase.functions.invoke("competitor-watch", { body: { action: "remove", company_id: companyId, id } });
    await refresh();
  };

  const promoteVariant = async (campaignId: string, variantId: string) => {
    if (!companyId) return;
    await supabase.functions.invoke("campaign-engine", { body: { action: "promote", company_id: companyId, campaign_id: campaignId, variant_id: variantId } });
    await refresh();
  };

  if (!companyId) {
    return (
      <div className="min-h-screen bg-background p-6 sm:p-10">
        <button onClick={() => navigate("/settings")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"><ArrowLeft className="w-4 h-4" /> Back to settings</button>
        <p className="text-muted-foreground">Select a business to see your Growth hub.</p>
      </div>
    );
  }

  const m = metrics || {};
  const stat = (label: string, value: any, icon: any, hint?: string) => (
    <Card className="card-glass">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-foreground leading-tight">{value ?? "--"}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          {hint && <p className="text-[10px] text-emerald-600">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <header className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate("/settings")}><ArrowLeft className="w-4 h-4" /></Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Growth</h1>
          <p className="text-muted-foreground mt-1">Your full marketing funnel — plan, run, measure, improve.</p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading} className="gap-2"><RefreshCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} /> Refresh</Button>
      </header>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full grid grid-cols-2 sm:grid-cols-5 mb-6">
          <TabsTrigger value="overview" className="gap-1.5"><TrendingUp className="w-4 h-4" />Overview</TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-1.5"><Rocket className="w-4 h-4" />Campaigns</TabsTrigger>
          <TabsTrigger value="brand" className="gap-1.5"><Palette className="w-4 h-4" />Brand Kit</TabsTrigger>
          <TabsTrigger value="sequences" className="gap-1.5"><Users className="w-4 h-4" />Follow-ups</TabsTrigger>
          <TabsTrigger value="competitors" className="gap-1.5"><Megaphone className="w-4 h-4" />Competitors</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {stat("Posts published", m.posts_published, <TrendingUp className="w-5 h-5" />)}
            {stat("Videos generated", m.videos_generated, <Video className="w-5 h-5" />)}
            {stat("Leads", m.leads, <Sparkles className="w-5 h-5" />)}
            {stat("Conversations", m.conversations, <MessageSquare className="w-5 h-5" />)}
            {stat("Agent replies", m.agent_replies, <Sparkles className="w-5 h-5" />)}
            {stat("Missed", m.unanswered_missed, <MessageSquare className="w-5 h-5" />)}
            {stat("Campaigns running", m.campaigns_running, <Rocket className="w-5 h-5" />)}
            {stat("KB documents", m.kb_grounded_docs, <FileText className="w-5 h-5" />)}
            {stat("Revenue", m.revenue != null ? m.revenue : "--", <TrendingUp className="w-5 h-5" />, m.transactions ? m.transactions + " payments" : undefined)}
          </div>
          {summary && (
            <Card className="card-glass">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="w-4 h-4 text-primary" /> This week</CardTitle>
              </CardHeader>
              <CardContent><p className="text-sm text-foreground">{summary}</p></CardContent>
            </Card>
          )}
        </TabsContent>

        {/* CAMPAIGNS */}
        <TabsContent value="campaigns" className="space-y-6">
          <Card className="card-glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Rocket className="w-5 h-5" /> Launch a campaign</CardTitle>
              <CardDescription>Describe the promo — the agent builds 3 on-brand A/B variants and schedules them.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Playbook</Label>
                  <Select value={playbook} onValueChange={setPlaybook}>
                    <SelectTrigger><SelectValue placeholder="Playbook" /></SelectTrigger>
                    <SelectContent>{PLAYBOOKS.map(p => <SelectItem key={p.key} value={p.key}>{p.label} — {p.objective}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Campaign name (optional)</Label>
                  <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. Weekend Flash Sale" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Brief</Label>
                <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} placeholder="e.g. 20% off all curtains this weekend, free delivery in Lusaka" />
              </div>
              <Button onClick={launchCampaign} disabled={launching || !brief.trim()} className="gap-2">
                {launching ? <><Loader2 className="w-4 h-4 animate-spin" /> Launching...</> : <><Rocket className="w-4 h-4" /> Launch campaign</>}
              </Button>
            </CardContent>
          </Card>

          {campaigns.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground border border-dashed rounded-lg">No campaigns yet. Launch one to get 3 A/B variants.</div>
          ) : (
            <div className="space-y-4">
              {campaigns.map((c: any) => (
                <Card key={c.id} className="card-glass">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">{c.name || "Campaign"}</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant={c.status === "running" ? "default" : "secondary"}>{c.status}</Badge>
                        <Badge variant="outline">{c.playbook}</Badge>
                      </div>
                    </div>
                    <CardDescription>{c.brief}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(c.variants || []).map((v: any) => (
                      <div key={v.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold uppercase text-muted-foreground">{v.label}</span>
                            <Badge variant="outline">{v.channel}</Badge>
                            {v.is_winner && <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30"><Trophy className="w-3 h-3 mr-1" />Winner</Badge>}
                          </div>
                          <p className="text-sm mt-1 line-clamp-2">{v.content}</p>
                          {v.score != null && <p className="text-xs text-muted-foreground mt-1">Score: {v.score}</p>}
                        </div>
                        {!v.is_winner && (
                          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => promoteVariant(c.id, v.id)}><Trophy className="w-3.5 h-3.5" />Promote</Button>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* BRAND KIT */}
        <TabsContent value="brand" className="space-y-6">
          <Card className="card-glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Palette className="w-5 h-5" /> Brand Kit</CardTitle>
              <CardDescription>Everything the agent enforces across posts and video — so it always sounds like you.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Tone</Label>
                <Input value={brand.tone} onChange={(e) => setBrand({ ...brand, tone: e.target.value })} placeholder="e.g. Warm, professional, local" />
              </div>
              <div className="space-y-2">
                <Label>Colours (JSON)</Label>
                <Input value={brand.colors} onChange={(e) => setBrand({ ...brand, colors: e.target.value })} placeholder='{ "primary": "#1E5631" }' />
              </div>
              <div className="space-y-2">
                <Label>Phrases to never use (comma-separated)</Label>
                <Input value={brand.no_go_phrases} onChange={(e) => setBrand({ ...brand, no_go_phrases: e.target.value })} placeholder="scam, cheap, fake" />
              </div>
              <div className="space-y-2">
                <Label>Brand guidelines</Label>
                <Textarea value={brand.guidelines} onChange={(e) => setBrand({ ...brand, guidelines: e.target.value })} rows={3} placeholder="e.g. Always mention free delivery, never discount below 10%..." />
              </div>
              <Button onClick={saveBrandKit} disabled={savingBrand} className="gap-2">{savingBrand ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><CheckCircle2 className="w-4 h-4" /> Save brand kit</>}</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SEQUENCES */}
        <TabsContent value="sequences" className="space-y-6">
          <Card className="card-glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> Follow-up sequence</CardTitle>
              <CardDescription>Turn a lead into a scheduled follow-up so nothing falls through.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Name</Label><Input value={seqName} onChange={(e) => setSeqName(e.target.value)} placeholder="Win back" /></div>
                <div className="space-y-2">
                  <Label>Trigger</Label>
                  <Select value={seqType} onValueChange={setSeqType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="abandoned_enquiry">Abandoned enquiry</SelectItem>
                      <SelectItem value="win_back">Win back</SelectItem>
                      <SelectItem value="post_purchase">Post-purchase</SelectItem>
                      <SelectItem value="birthday">Birthday</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Delay (days)</Label><Input type="number" min={0} value={seqDelay} onChange={(e) => setSeqDelay(Number(e.target.value))} /></div>
              </div>
              <div className="space-y-2"><Label>Message</Label><Textarea value={seqMessage} onChange={(e) => setSeqMessage(e.target.value)} rows={2} placeholder="e.g. Hi! You asked about our curtains — still want one? We can deliver today." /></div>
              <Button onClick={addSequence} disabled={addingSeq || !seqMessage.trim()} className="gap-2">{addingSeq ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</> : <><Sparkles className="w-4 h-4" /> Create sequence</>}</Button>
            </CardContent>
          </Card>

          {sequences.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground border border-dashed rounded-lg">No follow-up sequences yet.</div>
          ) : (
            <div className="space-y-3">
              {sequences.map((s: any) => (
                <Card key={s.id} className="card-glass">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.trigger_type} • {Array.isArray(s.steps) ? s.steps.length : 0} step(s)</p>
                    </div>
                    <Badge variant={s.enabled ? "default" : "secondary"}>{s.enabled ? "Enabled" : "Disabled"}</Badge>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => armSequence(s.id)}><Rocket className="w-3.5 h-3.5" />Arm next step</Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* COMPETITORS */}
        <TabsContent value="competitors" className="space-y-6">
          <Card className="card-glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Megaphone className="w-5 h-5" /> Market watch</CardTitle>
              <CardDescription>Track competitors and hashtags so the agent can position you to stand out.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Name</Label><Input value={compName} onChange={(e) => setCompName(e.target.value)} placeholder="e.g. Competitor Name" /></div>
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <Select value={compPlatform} onValueChange={setCompPlatform}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="facebook">Facebook page</SelectItem>
                      <SelectItem value="instagram">Instagram</SelectItem>
                      <SelectItem value="hashtag">Hashtag</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end"><Button onClick={addCompetitor} disabled={addingComp || !compName.trim()} className="gap-2">{addingComp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add</Button></div>
              </div>
              {insight && <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-foreground">{insight}</div>}
            </CardContent>
          </Card>
          {competitors.length > 0 && (
            <div className="space-y-2">
              {competitors.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="min-w-0">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.platform} • {c.identifier}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeCompetitor(c.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

// small inline Plus icon helper to avoid an extra import
const Plus = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
);

export default Growth;
