import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Trash2, Image as ImageIcon, Video } from "lucide-react";

interface CompanyMediaProps {
  companyId: string;
}

interface Media {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  media_type: string;
  description: string | null;
  tags: string[];
  created_at: string;
}

export default function CompanyMedia({ companyId }: CompanyMediaProps) {
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    loadMedia();
  }, [companyId]);

  const loadMedia = async () => {
    try {
      const { data, error } = await supabase
        .from('company_media')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMedia(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      toast({
        title: "File too large",
        description: "Maximum file size is 50MB",
        variant: "destructive",
      });
      return;
    }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    if (!isImage && !isVideo) {
      toast({
        title: "Invalid file type",
        description: "Only images and videos are allowed",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      console.log('Starting upload for company:', companyId);
      
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        console.error('User error:', userError);
        throw new Error('You must be logged in to upload media');
      }
      
      console.log('User authenticated:', user.id);

      const fileExt = file.name.split('.').pop();
      const fileName = `${companyId}/${Date.now()}.${fileExt}`;
      
      console.log('Uploading file:', fileName);

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('company-media')
        .upload(fileName, file);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw uploadError;
      }
      
      console.log('File uploaded successfully:', uploadData);

      console.log('Inserting into database...');
      const { error: dbError } = await supabase
        .from('company_media')
        .insert({
          company_id: companyId,
          file_name: file.name,
          file_path: fileName,
          file_type: file.type,
          file_size: file.size,
          media_type: isImage ? 'image' : 'video',
          description: description || null,
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
          uploaded_by: user.id
        });

      if (dbError) {
        console.error('Database error:', dbError);
        throw dbError;
      }
      
      console.log('Media record created successfully');

      toast({
        title: "Success",
        description: "Media uploaded successfully",
      });

      setDescription("");
      setTags("");
      loadMedia();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleDelete = async (mediaItem: Media) => {
    try {
      const { error: storageError } = await supabase.storage
        .from('company-media')
        .remove([mediaItem.file_path]);

      if (storageError) throw storageError;

      const { error: dbError } = await supabase
        .from('company_media')
        .delete()
        .eq('id', mediaItem.id);

      if (dbError) throw dbError;

      toast({
        title: "Success",
        description: "Media deleted successfully",
      });

      loadMedia();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getPublicUrl = (path: string) => {
    const { data } = supabase.storage.from('company-media').getPublicUrl(path);
    return data.publicUrl;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Media Library</CardTitle>
        <CardDescription>
          Upload images and videos that the AI can send to customers
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Describe what this media shows..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated, optional)</Label>
            <Input
              id="tags"
              placeholder="menu, food, interior, pool..."
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="file">Upload Image or Video</Label>
            <Input
              id="file"
              type="file"
              accept="image/*,video/*"
              onChange={handleFileUpload}
              disabled={uploading}
            />
            <p className="text-sm text-muted-foreground">
              Maximum file size: 50MB
            </p>
          </div>
          {uploading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading...
            </div>
          )}
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : media.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Upload className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No media uploaded yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {media.map((item) => (
                <div key={item.id} className="relative group border rounded-lg overflow-hidden">
                  {item.media_type === 'image' ? (
                    <img
                      src={getPublicUrl(item.file_path)}
                      alt={item.file_name}
                      className="w-full h-40 object-cover"
                    />
                  ) : (
                    <div className="w-full h-40 bg-muted flex items-center justify-center">
                      <Video className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                  <div className="p-2 space-y-1">
                    <p className="text-sm font-medium truncate">{item.file_name}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>
                    )}
                    {item.tags && item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.tags.map((tag, idx) => (
                          <span key={idx} className="text-xs bg-secondary px-2 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(item.file_size)}
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleDelete(item)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
