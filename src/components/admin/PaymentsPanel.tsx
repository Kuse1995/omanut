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
import { Plus, Edit, Trash2, CheckCircle, XCircle, Upload, Eye, AlertCircle } from 'lucide-react';
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
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProofDialogOpen, setIsProofDialogOpen] = useState(false);
  const [isVerifyDialogOpen, setIsVerifyDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [uploadingProof, setUploadingProof] = useState(false);
  const [verifyNotes, setVerifyNotes] = useState('');
  
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
    is_active: true
  });

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
      setProducts(data || []);
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
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;

    const productData = {
      company_id: selectedCompany.id,
      name: formData.name,
      description: formData.description || null,
      price: parseFloat(formData.price),
      currency: formData.currency,
      category: formData.category,
      duration_minutes: formData.duration_minutes ? parseInt(formData.duration_minutes) : null,
      is_active: formData.is_active
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
      is_active: product.is_active
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
      
      // TODO: Trigger post-payment workflow (WhatsApp confirmation, action items)
      // This would call the existing Twilio functions and create action items
      
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
      is_active: true
    });
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
            <DialogContent className="bg-card border-border max-w-2xl">
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
                </div>

                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingProduct ? 'Update Product' : 'Create Product'}
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
                    <h3 className="text-lg font-semibold text-foreground">{product.name}</h3>
                    {product.description && (
                      <p className="text-muted-foreground text-sm mt-1">{product.description}</p>
                    )}
                    <div className="flex gap-4 mt-2 text-sm text-foreground">
                      <span className="font-semibold">{product.currency} {product.price}</span>
                      {product.category && <span className="capitalize">{product.category.replace('_', ' ')}</span>}
                      {product.duration_minutes && <span>{product.duration_minutes} min</span>}
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
                <TableHead className="text-foreground">Proof</TableHead>
                <TableHead className="text-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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
        <DialogContent className="bg-card border-border max-w-3xl">
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
        <DialogContent className="bg-card border-border">
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
