import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Upload, Trash2, ImagePlus, Loader2, Package, Palette, Building2, FolderOpen } from 'lucide-react';
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

  const getImageUrl = (filePath: string) => {
    const { data } = supabase.storage.from('company-media').getPublicUrl(filePath);
    return data.publicUrl;
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
      
      const { error: dbError } = await supabase.from('company_media').insert({
        company_id: companyId, file_name: file.name, file_path: filePath, file_type: file.type,
        file_size: file.size, media_type: 'image', category: uploadCategory as MediaCategory
      });
      if (dbError) { toast.error(`Save failed: ${dbError.message}`); continue; }
      successCount++;
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
    onAssetsChange();
  };

  const filteredAssets = activeTab === 'all' ? assets : assets.filter(a => a.category === activeTab);
  const validCategories = Object.keys(categoryConfig) as UploadCategory[];

  return (
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
            <div className="h-2 bg-muted rounded-full mt-2"><div className="h-full bg-primary" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} /></div>
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
                  <div key={asset.id} className="group relative aspect-square rounded-lg overflow-hidden border bg-muted">
                    <img src={getImageUrl(asset.file_path)} alt={asset.file_name} className="w-full h-full object-cover" />
                    <Badge variant="secondary" className="absolute top-1 left-1 text-[10px] capitalize bg-background/80">{asset.category}</Badge>
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => deleteAsset(asset)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
