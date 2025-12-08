import { useEffect, useState } from 'react';
import { useCompany } from '@/context/CompanyContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, CheckCircle, XCircle, Upload, Eye, AlertCircle, Download, Package, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  category: string | null;
  duration_minutes: number | null;
  is_active: boolean;
  created_at: string;
  product_type: 'physical' | 'digital' | 'service';
  delivery_type: 'manual' | 'auto_download' | 'email_delivery';
  digital_file_path: string | null;
  download_url: string | null;
  download_limit: number | null;
  download_expiry_hours: number | null;
}

interface Transaction {
  id: string;
  product_id: string | null;
  customer_phone: string;
  customer_name: string | null;
  amount: number;
  currency: string;
  payment_method: string | null;
  payment_status: string;
  payment_reference: string | null;
  created_at: string;
  completed_at: string | null;
  payment_proof_url: string | null;
  payment_proof_uploaded_at: string | null;
  designated_number: string | null;
  verification_status: string | null;
  verified_by: string | null;
  verified_at: string | null;
  admin_notes: string | null;
}

interface DeliveryStatus {
  id: string;
  transaction_id: string;
  download_count: number;
  max_downloads: number;
  delivered_at: string | null;
  expires_at: string | null;
}

interface PaymentNumbers {
  payment_number_mtn: string;
  payment_number_airtel: string;
  payment_number_zamtel: string;
  payment_instructions: string;
}

export const PaymentsPanel = () => {
  const { selectedCompany } = useCompany();
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, DeliveryStatus>>({});
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProofDialogOpen, setIsProofDialogOpen] = useState(false);
  const [isVerifyDialogOpen, setIsVerifyDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [uploadingProof, setUploadingProof] = useState(false);
  const [verifyNotes, setVerifyNotes] = useState('');
  const [deliveringProduct, setDeliveringProduct] = useState<string | null>(null);
  
  const [paymentNumbers, setPaymentNumbers] = useState<PaymentNumbers>({
    payment_number_mtn: '',
    payment_number_airtel: '',
    payment_number_zamtel: '',
    payment_instructions: 'Send payment to the designated number and upload proof of payment for verification.'
  });
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    currency: 'ZMW',
    category: 'video_ad',
    duration_minutes: '',
    is_active: true,
    product_type: 'service' as 'physical' | 'digital' | 'service',
    delivery_type: 'manual' as 'manual' | 'auto_download' | 'email_delivery',
    digital_file_path: '',
    download_url: '',
    download_limit: '3',
    download_expiry_hours: '48'
  });
  const [digitalFile, setDigitalFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    if (selectedCompany) {
      loadProducts();
      loadTransactions();
      loadPaymentNumbers();
    }
  }, [selectedCompany]);

  const loadPaymentNumbers = async () => {
    if (!selectedCompany) return;
    
    const { data, error } = await supabase
      .from('companies')
      .select('payment_number_mtn, payment_number_airtel, payment_number_zamtel, payment_instructions')
      .eq('id', selectedCompany.id)
      .single();

    if (!error && data) {
      setPaymentNumbers({
        payment_number_mtn: data.payment_number_mtn || '',
        payment_number_airtel: data.payment_number_airtel || '',
        payment_number_zamtel: data.payment_number_zamtel || '',
        payment_instructions: data.payment_instructions || 'Send payment to the designated number and upload proof of payment for verification.'
      });
    }
  };

  const savePaymentNumbers = async () => {
    if (!selectedCompany) return;

    const { error } = await supabase
      .from('companies')
      .update({
        payment_number_mtn: paymentNumbers.payment_number_mtn || null,
        payment_number_airtel: paymentNumbers.payment_number_airtel || null,
        payment_number_zamtel: paymentNumbers.payment_number_zamtel || null,
        payment_instructions: paymentNumbers.payment_instructions
      })
      .eq('id', selectedCompany.id);

    if (error) {
      toast.error('Failed to save payment numbers');
      console.error(error);
    } else {
      toast.success('Payment numbers saved successfully');
    }
  };

  const loadProducts = async () => {
    if (!selectedCompany) return;
    
    setLoading(true);
    const { data, error } = await supabase
      .from('payment_products')
      .select('*')
      .eq('company_id', selectedCompany.id)
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Failed to load products');
      console.error(error);
    } else {
      setProducts((data || []) as Product[]);
    }
    setLoading(false);
  };

  const loadTransactions = async () => {
    if (!selectedCompany) return;
    
    const { data, error } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('company_id', selectedCompany.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      toast.error('Failed to load transactions');
      console.error(error);
    } else {
      setTransactions(data || []);
      
      // Load delivery statuses for transactions
      const transactionIds = (data || []).map(t => t.id);
      if (transactionIds.length > 0) {
        const { data: deliveryData } = await supabase
          .from('digital_product_deliveries')
          .select('id, transaction_id, download_count, max_downloads, delivered_at, expires_at')
          .in('transaction_id', transactionIds);
        
        if (deliveryData) {
          const deliveryMap: Record<string, DeliveryStatus> = {};
          deliveryData.forEach(d => {
            if (d.transaction_id) {
              deliveryMap[d.transaction_id] = d as DeliveryStatus;
            }
          });
          setDeliveries(deliveryMap);
        }
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;

    setUploadingFile(true);
    setUploadProgress(0);
    let digitalFilePath = formData.digital_file_path;

    // Upload digital file if provided with progress tracking
    if (digitalFile && formData.product_type === 'digital') {
      try {
        const fileName = `${selectedCompany.id}/${Date.now()}_${digitalFile.name}`;
        
        // Use XMLHttpRequest for progress tracking
        const uploadPromise = new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          
          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const percentComplete = Math.round((event.loaded / event.total) * 100);
              setUploadProgress(percentComplete);
            }
          });
          
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          });
          
          xhr.addEventListener('error', () => reject(new Error('Upload failed')));
          xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
          
          // Get the Supabase storage URL and auth token
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
          const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
          const uploadUrl = `${supabaseUrl}/storage/v1/object/digital-products/${fileName}`;
          
          xhr.open('POST', uploadUrl);
          xhr.setRequestHeader('Authorization', `Bearer ${supabaseKey}`);
          xhr.setRequestHeader('x-upsert', 'false');
          xhr.send(digitalFile);
        });
        
        await uploadPromise;
        digitalFilePath = fileName;
        toast.success('Digital file uploaded successfully');
      } catch (error) {
        console.error('Error uploading digital file:', error);
        toast.error('Failed to upload digital file');
        setUploadingFile(false);
        setUploadProgress(0);
        return;
      }
    }

    const productData = {
      company_id: selectedCompany.id,
      name: formData.name,
      description: formData.description || null,
      price: parseFloat(formData.price),
      currency: formData.currency,
      category: formData.category,
      duration_minutes: formData.duration_minutes ? parseInt(formData.duration_minutes) : null,
      is_active: formData.is_active,
      product_type: formData.product_type,
      delivery_type: formData.delivery_type,
      digital_file_path: digitalFilePath || null,
      download_url: formData.download_url || null,
      download_limit: formData.download_limit ? parseInt(formData.download_limit) : 3,
      download_expiry_hours: formData.download_expiry_hours ? parseInt(formData.download_expiry_hours) : 48
    };

    if (editingProduct) {
      const { error } = await supabase
        .from('payment_products')
        .update(productData)
        .eq('id', editingProduct.id);

      if (error) {
        toast.error('Failed to update product');
        console.error(error);
      } else {
        toast.success('Product updated successfully');
        resetForm();
        loadProducts();
      }
    } else {
      const { error } = await supabase
        .from('payment_products')
        .insert(productData);

      if (error) {
        toast.error('Failed to create product');
        console.error(error);
      } else {
        toast.success('Product created successfully');
        resetForm();
        loadProducts();
      }
    }
    setUploadingFile(false);
    setUploadProgress(0);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;

    const { error } = await supabase
      .from('payment_products')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Failed to delete product');
      console.error(error);
    } else {
      toast.success('Product deleted');
      loadProducts();
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description || '',
      price: product.price.toString(),
      currency: product.currency,
      category: product.category || 'video_ad',
      duration_minutes: product.duration_minutes?.toString() || '',
      is_active: product.is_active,
      product_type: product.product_type || 'service',
      delivery_type: product.delivery_type || 'manual',
      digital_file_path: product.digital_file_path || '',
      download_url: product.download_url || '',
      download_limit: product.download_limit?.toString() || '3',
      download_expiry_hours: product.download_expiry_hours?.toString() || '48'
    });
    setIsDialogOpen(true);
  };

  const uploadPaymentProof = async (transactionId: string, file: File) => {
    setUploadingProof(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${transactionId}_${Date.now()}.${fileExt}`;
      const filePath = `${selectedCompany?.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('payment-proofs')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('payment-proofs')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('payment_transactions')
        .update({
          payment_proof_url: publicUrl,
          payment_proof_uploaded_at: new Date().toISOString(),
          verification_status: 'proof_submitted'
        })
        .eq('id', transactionId);

      if (updateError) throw updateError;

      toast.success('Payment proof uploaded successfully');
      loadTransactions();
      setIsProofDialogOpen(false);
    } catch (error) {
      console.error('Error uploading proof:', error);
      toast.error('Failed to upload payment proof');
    } finally {
      setUploadingProof(false);
    }
  };

  const verifyPayment = async (transactionId: string, approved: boolean) => {
    if (!selectedCompany) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const updates: any = {
        verification_status: approved ? 'verified' : 'rejected',
        verified_by: user?.id,
        verified_at: new Date().toISOString(),
        admin_notes: verifyNotes
      };

      if (approved) {
        updates.payment_status = 'completed';
        updates.completed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('payment_transactions')
        .update(updates)
        .eq('id', transactionId);

      if (error) throw error;

      toast.success(approved ? 'Payment verified successfully' : 'Payment rejected');
      
      // Auto-deliver digital product if payment approved
      if (approved) {
        const transaction = transactions.find(t => t.id === transactionId);
        if (transaction?.product_id) {
          const product = products.find(p => p.id === transaction.product_id);
          if (product?.product_type === 'digital' && product.delivery_type === 'auto_download') {
            try {
              const { error: deliveryError } = await supabase.functions.invoke('deliver-digital-product', {
                body: {
                  transaction_id: transactionId,
                  product_id: product.id,
                  company_id: selectedCompany.id,
                  customer_phone: transaction.customer_phone,
                  customer_email: transaction.customer_name // Using name field for now, could add email
                }
              });
              
              if (deliveryError) {
                console.error('Digital delivery error:', deliveryError);
                toast.error('Payment verified but digital delivery failed');
              } else {
                toast.success('Digital product delivered automatically');
              }
            } catch (deliveryErr) {
              console.error('Error triggering digital delivery:', deliveryErr);
            }
          }
        }
      }
      
      loadTransactions();
      setIsVerifyDialogOpen(false);
      setVerifyNotes('');
    } catch (error) {
      console.error('Error verifying payment:', error);
      toast.error('Failed to verify payment');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      price: '',
      currency: 'ZMW',
      category: 'video_ad',
      duration_minutes: '',
      is_active: true,
      product_type: 'service',
      delivery_type: 'manual',
      digital_file_path: '',
      download_url: '',
      download_limit: '3',
      download_expiry_hours: '48'
    });
    setDigitalFile(null);
    setEditingProduct(null);
    setIsDialogOpen(false);
  };

  const filteredTransactions = transactions.filter(t => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'pending_verification') return t.verification_status === 'proof_submitted';
    return t.payment_status === filterStatus;
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      pending: 'secondary',
      completed: 'default',
      failed: 'destructive',
      cancelled: 'destructive'
    };
    return <Badge variant={variants[status] || 'secondary'}>{status}</Badge>;
  };

  const getVerificationBadge = (status: string | null) => {
    if (!status) return <Badge variant="secondary">pending</Badge>;
    
    const variants: Record<string, any> = {
      pending: { variant: 'secondary', label: 'Pending' },
      proof_submitted: { variant: 'default', label: 'Proof Submitted', icon: <AlertCircle className="w-3 h-3 mr-1" /> },
      verified: { variant: 'default', label: 'Verified', icon: <CheckCircle className="w-3 h-3 mr-1" /> },
      rejected: { variant: 'destructive', label: 'Rejected', icon: <XCircle className="w-3 h-3 mr-1" /> }
    };
    
    const config = variants[status] || variants.pending;
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        {config.icon}
        {config.label}
      </Badge>
    );
  };

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select a company to manage products & payments</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Payment Numbers Configuration */}
      <Card className="bg-card border-border p-6">
        <h2 className="text-2xl font-bold text-foreground mb-4">Payment Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <Label htmlFor="mtn" className="text-foreground">MTN Number</Label>
            <Input
              id="mtn"
              value={paymentNumbers.payment_number_mtn}
              onChange={(e) => setPaymentNumbers({ ...paymentNumbers, payment_number_mtn: e.target.value })}
              placeholder="0977XXXXXX"
              className="bg-background border-border text-foreground"
            />
          </div>
          <div>
            <Label htmlFor="airtel" className="text-foreground">Airtel Number</Label>
            <Input
              id="airtel"
              value={paymentNumbers.payment_number_airtel}
              onChange={(e) => setPaymentNumbers({ ...paymentNumbers, payment_number_airtel: e.target.value })}
              placeholder="0966XXXXXX"
              className="bg-background border-border text-foreground"
            />
          </div>
          <div>
            <Label htmlFor="zamtel" className="text-foreground">Zamtel Number</Label>
            <Input
              id="zamtel"
              value={paymentNumbers.payment_number_zamtel}
              onChange={(e) => setPaymentNumbers({ ...paymentNumbers, payment_number_zamtel: e.target.value })}
              placeholder="0955XXXXXX"
              className="bg-background border-border text-foreground"
            />
          </div>
        </div>
        <div className="mb-4">
          <Label htmlFor="instructions" className="text-foreground">Payment Instructions</Label>
          <Textarea
            id="instructions"
            value={paymentNumbers.payment_instructions}
            onChange={(e) => setPaymentNumbers({ ...paymentNumbers, payment_instructions: e.target.value })}
            placeholder="Custom instructions for customers..."
            rows={3}
            className="bg-background border-border text-foreground"
          />
        </div>
        <Button onClick={savePaymentNumbers}>Save Payment Configuration</Button>
      </Card>

      {/* Products Section */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-foreground">Products & Services</h2>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => resetForm()}>
                <Plus className="w-4 h-4 mr-2" />
                Add Product
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-foreground">
                  {editingProduct ? 'Edit Product' : 'Add New Product'}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label htmlFor="name" className="text-foreground">Product Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., 30-Second Video Ad"
                      required
                      className="bg-background border-border text-foreground"
                    />
                  </div>
                  
                  <div className="col-span-2">
                    <Label htmlFor="description" className="text-foreground">Description</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Describe the product..."
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  <div>
                    <Label htmlFor="product_type" className="text-foreground">Product Type</Label>
                    <Select value={formData.product_type} onValueChange={(value: 'physical' | 'digital' | 'service') => setFormData({ ...formData, product_type: value })}>
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="service">Service</SelectItem>
                        <SelectItem value="digital">Digital Product</SelectItem>
                        <SelectItem value="physical">Physical Product</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="price" className="text-foreground">Price</Label>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                      placeholder="1000"
                      required
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  <div>
                    <Label htmlFor="currency" className="text-foreground">Currency</Label>
                    <Select value={formData.currency} onValueChange={(value) => setFormData({ ...formData, currency: value })}>
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ZMW">ZMW (Kwacha)</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="category" className="text-foreground">Category</Label>
                    <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="video_ad">Video Ad</SelectItem>
                        <SelectItem value="image_design">Image Design</SelectItem>
                        <SelectItem value="logo">Logo Design</SelectItem>
                        <SelectItem value="ebook">E-Book</SelectItem>
                        <SelectItem value="template">Template</SelectItem>
                        <SelectItem value="course">Course/Tutorial</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="duration" className="text-foreground">Duration (minutes)</Label>
                    <Input
                      id="duration"
                      type="number"
                      value={formData.duration_minutes}
                      onChange={(e) => setFormData({ ...formData, duration_minutes: e.target.value })}
                      placeholder="15, 30, 60"
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  {/* Digital Product Options */}
                  {formData.product_type === 'digital' && (
                    <>
                      <div className="col-span-2 border-t border-border pt-4 mt-2">
                        <h4 className="text-sm font-semibold text-foreground mb-3">Digital Product Settings</h4>
                      </div>
                      
                      <div>
                        <Label htmlFor="delivery_type" className="text-foreground">Delivery Method</Label>
                        <Select value={formData.delivery_type} onValueChange={(value: 'manual' | 'auto_download' | 'email_delivery') => setFormData({ ...formData, delivery_type: value })}>
                          <SelectTrigger className="bg-background border-border text-foreground">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto_download">Auto Deliver (WhatsApp)</SelectItem>
                            <SelectItem value="email_delivery">Email Delivery</SelectItem>
                            <SelectItem value="manual">Manual Delivery</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="download_limit" className="text-foreground">Download Limit</Label>
                        <Input
                          id="download_limit"
                          type="number"
                          value={formData.download_limit}
                          onChange={(e) => setFormData({ ...formData, download_limit: e.target.value })}
                          placeholder="3"
                          className="bg-background border-border text-foreground"
                        />
                      </div>

                      <div>
                        <Label htmlFor="download_expiry" className="text-foreground">Link Expires (hours)</Label>
                        <Input
                          id="download_expiry"
                          type="number"
                          value={formData.download_expiry_hours}
                          onChange={(e) => setFormData({ ...formData, download_expiry_hours: e.target.value })}
                          placeholder="48"
                          className="bg-background border-border text-foreground"
                        />
                      </div>

                      <div className="col-span-2">
                        <Label htmlFor="digital_file" className="text-foreground">Upload Digital File</Label>
                        <Input
                          id="digital_file"
                          type="file"
                          onChange={(e) => setDigitalFile(e.target.files?.[0] || null)}
                          className="bg-background border-border text-foreground"
                          disabled={uploadingFile}
                        />
                        {digitalFile && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Selected: {digitalFile.name} ({(digitalFile.size / 1024 / 1024).toFixed(2)} MB)
                          </p>
                        )}
                        {formData.digital_file_path && !digitalFile && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Current file: {formData.digital_file_path.split('/').pop()}
                          </p>
                        )}
                        {uploadingFile && (
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-primary" />
                              <span className="text-sm text-muted-foreground">
                                Uploading... {uploadProgress}%
                              </span>
                            </div>
                            <Progress value={uploadProgress} className="h-2" />
                          </div>
                        )}
                      </div>

                      <div className="col-span-2">
                        <Label htmlFor="download_url" className="text-foreground">Or External Download URL</Label>
                        <Input
                          id="download_url"
                          value={formData.download_url}
                          onChange={(e) => setFormData({ ...formData, download_url: e.target.value })}
                          placeholder="https://drive.google.com/..."
                          className="bg-background border-border text-foreground"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Use if file is hosted externally (Google Drive, Dropbox, etc.)
                        </p>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={uploadingFile}>
                    {uploadingFile ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Uploading... {uploadProgress}%
                      </span>
                    ) : editingProduct ? 'Update Product' : 'Create Product'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-4">
          {loading ? (
            <div className="text-muted-foreground text-center py-8">Loading products...</div>
          ) : products.length === 0 ? (
            <Card className="bg-card border-border p-8 text-center">
              <p className="text-muted-foreground">No products yet. Create your first product to start accepting payments!</p>
            </Card>
          ) : (
            products.map((product) => (
              <Card key={product.id} className="bg-card border-border p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-foreground">{product.name}</h3>
                      {product.product_type === 'digital' && (
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Download className="w-3 h-3" />
                          Digital
                        </Badge>
                      )}
                      {product.product_type === 'physical' && (
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Package className="w-3 h-3" />
                          Physical
                        </Badge>
                      )}
                    </div>
                    {product.description && (
                      <p className="text-muted-foreground text-sm mt-1">{product.description}</p>
                    )}
                    <div className="flex gap-4 mt-2 text-sm text-foreground">
                      <span className="font-semibold">{product.currency} {product.price}</span>
                      {product.category && <span className="capitalize">{product.category.replace('_', ' ')}</span>}
                      {product.duration_minutes && <span>{product.duration_minutes} min</span>}
                      {product.product_type === 'digital' && product.delivery_type === 'auto_download' && (
                        <span className="text-green-500">Auto-deliver</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Badge variant={product.is_active ? 'default' : 'secondary'}>
                      {product.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => handleEdit(product)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(product.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Transactions Section */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-foreground">Payment Transactions</h2>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[200px] bg-background border-border text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending Payment</SelectItem>
              <SelectItem value="pending_verification">Pending Verification</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="bg-card border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-foreground">Date</TableHead>
                <TableHead className="text-foreground">Customer</TableHead>
                <TableHead className="text-foreground">Amount</TableHead>
                <TableHead className="text-foreground">Method</TableHead>
                <TableHead className="text-foreground">Payment Status</TableHead>
                <TableHead className="text-foreground">Verification</TableHead>
                <TableHead className="text-foreground">Delivery</TableHead>
                <TableHead className="text-foreground">Proof</TableHead>
                <TableHead className="text-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No transactions found
                  </TableCell>
                </TableRow>
              ) : (
                filteredTransactions.map((transaction) => (
                  <TableRow key={transaction.id} className="border-border">
                    <TableCell className="text-foreground">
                      {new Date(transaction.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-foreground">
                      <div>
                        <div>{transaction.customer_name || 'Unknown'}</div>
                        <div className="text-xs text-muted-foreground">{transaction.customer_phone}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground font-semibold">
                      {transaction.currency} {transaction.amount}
                    </TableCell>
                    <TableCell className="text-foreground capitalize">
                      {transaction.payment_method?.replace('manual_', '') || 'N/A'}
                    </TableCell>
                    <TableCell>{getStatusBadge(transaction.payment_status)}</TableCell>
                    <TableCell>{getVerificationBadge(transaction.verification_status)}</TableCell>
                    <TableCell>
                      {(() => {
                        const delivery = deliveries[transaction.id];
                        const product = products.find(p => p.id === transaction.product_id);
                        if (product?.product_type !== 'digital') return <span className="text-muted-foreground text-xs">N/A</span>;
                        if (!delivery) return <Badge variant="secondary">Not Sent</Badge>;
                        return (
                          <div className="flex flex-col gap-1">
                            <Badge variant="default" className="text-xs">
                              <Download className="w-3 h-3 mr-1" />
                              {delivery.download_count}/{delivery.max_downloads}
                            </Badge>
                            {delivery.delivered_at && (
                              <span className="text-xs text-muted-foreground">
                                {new Date(delivery.delivered_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {transaction.payment_proof_url ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedTransaction(transaction);
                            setIsProofDialogOpen(true);
                          }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedTransaction(transaction);
                            document.getElementById(`proof-upload-${transaction.id}`)?.click();
                          }}
                        >
                          <Upload className="w-4 h-4 mr-1" />
                          Upload
                        </Button>
                      )}
                      <input
                        id={`proof-upload-${transaction.id}`}
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadPaymentProof(transaction.id, file);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {transaction.verification_status === 'proof_submitted' && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedTransaction(transaction);
                              setIsVerifyDialogOpen(true);
                            }}
                          >
                            Review
                          </Button>
                        )}
                        {transaction.payment_status === 'completed' && transaction.product_id && (() => {
                          const product = products.find(p => p.id === transaction.product_id);
                          return product?.product_type === 'digital';
                        })() && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={deliveringProduct === transaction.id}
                            onClick={async () => {
                              setDeliveringProduct(transaction.id);
                              try {
                                const { error } = await supabase.functions.invoke('deliver-digital-product', {
                                  body: {
                                    transaction_id: transaction.id,
                                    product_id: transaction.product_id,
                                    company_id: selectedCompany?.id,
                                    customer_phone: transaction.customer_phone
                                  }
                                });
                              if (error) throw error;
                                toast.success('Digital product delivered');
                                loadTransactions(); // Refresh to show delivery status
                              } catch (err) {
                                console.error('Delivery error:', err);
                                toast.error('Failed to deliver product');
                              } finally {
                                setDeliveringProduct(null);
                              }
                            }}
                          >
                            <Download className="w-4 h-4 mr-1" />
                            {deliveringProduct === transaction.id ? 'Sending...' : 'Deliver'}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Proof Viewer Dialog */}
      <Dialog open={isProofDialogOpen} onOpenChange={setIsProofDialogOpen}>
        <DialogContent className="bg-card border-border max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Payment Proof</DialogTitle>
          </DialogHeader>
          {selectedTransaction?.payment_proof_url && (
            <div className="space-y-4">
              <img
                src={selectedTransaction.payment_proof_url}
                alt="Payment Proof"
                className="w-full h-auto rounded-lg"
              />
              <div className="text-sm text-muted-foreground">
                <p>Uploaded: {selectedTransaction.payment_proof_uploaded_at ? new Date(selectedTransaction.payment_proof_uploaded_at).toLocaleString() : 'N/A'}</p>
                <p>Reference: {selectedTransaction.payment_reference}</p>
                <p>Amount: {selectedTransaction.currency} {selectedTransaction.amount}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Verification Dialog */}
      <Dialog open={isVerifyDialogOpen} onOpenChange={setIsVerifyDialogOpen}>
        <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Verify Payment</DialogTitle>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="text-sm space-y-2">
                <p className="text-foreground"><strong>Customer:</strong> {selectedTransaction.customer_name}</p>
                <p className="text-foreground"><strong>Amount:</strong> {selectedTransaction.currency} {selectedTransaction.amount}</p>
                <p className="text-foreground"><strong>Reference:</strong> {selectedTransaction.payment_reference}</p>
                <p className="text-foreground"><strong>Designated Number:</strong> {selectedTransaction.designated_number}</p>
              </div>
              
              {selectedTransaction.payment_proof_url && (
                <img
                  src={selectedTransaction.payment_proof_url}
                  alt="Payment Proof"
                  className="w-full h-auto rounded-lg max-h-96 object-contain"
                />
              )}

              <div>
                <Label htmlFor="notes" className="text-foreground">Admin Notes</Label>
                <Textarea
                  id="notes"
                  value={verifyNotes}
                  onChange={(e) => setVerifyNotes(e.target.value)}
                  placeholder="Add notes about verification..."
                  className="bg-background border-border text-foreground"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsVerifyDialogOpen(false);
                    setVerifyNotes('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => verifyPayment(selectedTransaction.id, false)}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Reject
                </Button>
                <Button
                  onClick={() => verifyPayment(selectedTransaction.id, true)}
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Verify & Approve
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
