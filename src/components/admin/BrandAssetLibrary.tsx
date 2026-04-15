import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { Upload, Trash2, ImagePlus, Loader2, Package, Palette, Building2, FolderOpen, Pencil, RotateCw, Link2 } from 'lucide-react';
import { Database } from '@/integrations/supabase/types';

type MediaCategory = Database['public']['Enums']['media_category'];
type UploadCategory = 'products' | 'promotional' | 'logo' | 'other';

interface BrandAsset {
  id: string;
  file_name: string;
  file_path: string;
  description: string | null;
  tags?: string[] | null;
  category?: string;
  created_at: string;
  bms_product_id?: string | null;
}

interface BmsProduct {
  id?: string;
  name?: string;
  product_name?: string;
  sku?: string;
  price?: number;
  selling_price?: number;
}

interface BrandAssetLibraryProps {
  companyId: string;
  assets: BrandAsset[];
  onAssetsChange: () => void;
}

const categoryConfig: Record<UploadCategory, { label: string; icon: React.ReactNode }> = {
  products: { label: 'Products', icon: <Package className="h-4 w-4" /> },
  promotional: { label: 'Promotional', icon: <Palette className="h-4 w-4" /> },
  logo: { label: 'Logo', icon: <Building2 className="h-4 w-4" /> },
  other: { label: 'Other', icon: <FolderOpen className="h-4 w-4" /> }
};

export const BrandAssetLibrary = ({ companyId, assets, onAssetsChange }: BrandAssetLibraryProps) => {
  const [uploadingRef, setUploadingRef] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [uploadCategory, setUploadCategory] = useState<UploadCategory>('products');
  const [activeTab, setActiveTab] = useState<UploadCategory | 'all'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit dialog state
  const [editingAsset, setEditingAsset] = useState<BrandAsset | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editBmsProductId, setEditBmsProductId] = useState('');
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  // BMS products state
  const [bmsProducts, setBmsProducts] = useState<BmsProduct[]>([]);
  const [loadingBmsProducts, setLoadingBmsProducts] = useState(false);

  // Load BMS products once
  useEffect(() => {
    const fetchBmsProducts = async () => {
      setLoadingBmsProducts(true);
      try {
        const { data, error } = await supabase.functions.invoke('bms-agent', {
          body: { action: 'list_products', params: { company_id: companyId } }
        });
        if (!error && data?.success && Array.isArray(data.data)) {
          setBmsProducts(data.data);
        }
      } catch (e) {
        console.log('BMS products not available:', e);
      } finally {
        setLoadingBmsProducts(false);
      }
    };
    fetchBmsProducts();
  }, [companyId]);

  const getImageUrl = (filePath: string) => {
    const { data } = supabase.storage.from('company-media').getPublicUrl(filePath);
    return data.publicUrl;
  };

  const openEditDialog = (asset: BrandAsset) => {
    setEditingAsset(asset);
    setEditDescription(asset.description || '');
    setEditTags(asset.tags?.join(', ') || '');
    setEditBmsProductId(asset.bms_product_id || '');
  };

  const handleSave = async () => {
    if (!editingAsset) return;
    setSaving(true);
    const tagsArray = editTags.split(',').map(t => t.trim()).filter(Boolean);
    const { error } = await supabase
      .from('company_media')
      .update({ description: editDescription, tags: tagsArray, bms_product_id: editBmsProductId || null } as any)
      .eq('id', editingAsset.id);
    setSaving(false);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    toast.success('Asset updated');
    setEditingAsset(null);
    onAssetsChange();
  };

  const handleReindex = async () => {
    if (!editingAsset) return;
    setReindexing(true);
    const { error } = await supabase.functions.invoke('index-brand-asset', {
      body: { media_id: editingAsset.id, company_id: companyId }
    });
    setReindexing(false);
    if (error) { toast.error('Re-index failed: ' + error.message); return; }
    toast.success('Re-indexed successfully');
    setEditingAsset(null);
    onAssetsChange();
  };

  const uploadAssets = async (files: FileList | File[]) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { toast.error('Please log in'); return; }
    
    const validFiles = Array.from(files).filter(file => file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024);
    if (validFiles.length === 0) return;
    
    setUploadingRef(true);
    let successCount = 0;
    
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      setUploadProgress({ current: i + 1, total: validFiles.length, fileName: file.name });
      const filePath = `${companyId}/${uploadCategory}/${Date.now()}_${Math.random().toString(36).slice(2)}.${file.name.split('.').pop()}`;
      
      const { error: uploadError } = await supabase.storage.from('company-media').upload(filePath, file, { upsert: true });
      if (uploadError) { toast.error(`Upload failed: ${uploadError.message}`); continue; }
      
      const { data: dbData, error: dbError } = await supabase.from('company_media').insert({
        company_id: companyId, file_name: file.name, file_path: filePath, file_type: file.type,
        file_size: file.size, media_type: 'image', category: uploadCategory as MediaCategory
      }).select('id').single();
      if (dbError) { toast.error(`Save failed: ${dbError.message}`); continue; }
      successCount++;
      
      if (dbData?.id) {
        supabase.functions.invoke('index-brand-asset', {
          body: { media_id: dbData.id, company_id: companyId }
        }).then(({ error: indexErr }) => {
          if (indexErr) console.error('Auto-index failed:', indexErr);
          else console.log('Auto-indexed:', file.name);
        });
      }
    }
    
    if (successCount > 0) { toast.success(`${successCount} asset(s) uploaded`); onAssetsChange(); }
    setUploadingRef(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const deleteAsset = async (asset: BrandAsset) => {
    await supabase.storage.from('company-media').remove([asset.file_path]);
    await supabase.from('company_media').delete().eq('id', asset.id);
    toast.success('Asset deleted');
    setEditingAsset(null);
    onAssetsChange();
  };

  const filteredAssets = activeTab === 'all' ? assets : assets.filter(a => a.category === activeTab);
  const validCategories = Object.keys(categoryConfig) as UploadCategory[];

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" /> Brand Asset Library</CardTitle>
          <CardDescription>Upload and manage brand assets for AI image generation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={uploadCategory} onValueChange={(v) => setUploadCategory(v as UploadCategory)}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                {validCategories.map((key) => (
                  <SelectItem key={key} value={key}>
                    <span className="flex items-center gap-2">{categoryConfig[key].icon}{categoryConfig[key].label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files?.length && uploadAssets(e.target.files)} />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploadingRef}>
              {uploadingRef ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {uploadingRef && uploadProgress ? `${uploadProgress.current}/${uploadProgress.total}` : 'Upload'}
            </Button>
          </div>

          {uploadingRef && uploadProgress && (
            <div className="p-3 rounded-lg border bg-muted/50">
              <div className="flex justify-between text-sm"><span>{uploadProgress.fileName}</span><span>{uploadProgress.current}/{uploadProgress.total}</span></div>
              <div className="h-2 bg-muted rounded-full mt-2"><div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} /></div>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as UploadCategory | 'all')}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="all">All ({assets.length})</TabsTrigger>
              {validCategories.map((key) => (
                <TabsTrigger key={key} value={key} className="gap-1">{categoryConfig[key].icon}<span className="hidden sm:inline">{categoryConfig[key].label}</span></TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={activeTab} className="mt-4">
              {filteredAssets.length === 0 ? (
                <div className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50" onClick={() => fileInputRef.current?.click()}>
                  <ImagePlus className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Click to upload</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {filteredAssets.map((asset) => (
                    <Tooltip key={asset.id}>
                      <TooltipTrigger asChild>
                        <div
                          className="group relative aspect-square rounded-lg overflow-hidden border bg-muted cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                          onClick={() => openEditDialog(asset)}
                        >
                          <img src={getImageUrl(asset.file_path)} alt={asset.file_name} className="w-full h-full object-cover" />
                          <Badge variant="secondary" className="absolute top-1 left-1 text-[10px] capitalize bg-background/80">{asset.category}</Badge>
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Pencil className="h-5 w-5 text-white" />
                          </div>
                          {asset.description && (
                            <div className="absolute bottom-0 inset-x-0 bg-background/80 px-1.5 py-0.5 text-[10px] text-foreground truncate opacity-0 group-hover:opacity-100 transition-opacity">
                              {asset.description.slice(0, 50)}
                            </div>
                          )}
                        </div>
                      </TooltipTrigger>
                      {asset.description && (
                        <TooltipContent side="bottom" className="max-w-[200px]">
                          <p className="text-xs">{asset.description.slice(0, 100)}{asset.description.length > 100 ? '…' : ''}</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Edit Asset Dialog */}
      <Dialog open={!!editingAsset} onOpenChange={(open) => !open && setEditingAsset(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Asset</DialogTitle>
          </DialogHeader>
          {editingAsset && (
            <div className="space-y-4">
              <div className="rounded-lg overflow-hidden border bg-muted max-h-48 flex items-center justify-center">
                <img src={getImageUrl(editingAsset.file_path)} alt={editingAsset.file_name} className="max-h-48 object-contain" />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="truncate">{editingAsset.file_name}</span>
                <Badge variant="secondary" className="capitalize">{editingAsset.category}</Badge>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="AI-generated description will appear here…"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tags (comma-separated)</label>
                <Input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="e.g. product, red, summer"
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="destructive" size="sm" onClick={() => editingAsset && deleteAsset(editingAsset)} className="mr-auto">
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
            <Button variant="outline" size="sm" onClick={handleReindex} disabled={reindexing}>
              {reindexing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCw className="h-4 w-4 mr-1" />}
              Re-index
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
};
