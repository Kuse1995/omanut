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
import { Plus, Edit, Trash2, CheckCircle, XCircle, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  category: string | null;
  selar_link: string | null;
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
  payment_link: string | null;
  created_at: string;
  completed_at: string | null;
}

interface ProductWithDetails extends Product {
  _count?: { transactions: number };
}

export const PaymentsPanel = () => {
  const { selectedCompany } = useCompany();
  const [products, setProducts] = useState<ProductWithDetails[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    currency: 'ZMW',
    category: 'video_ad',
    selar_link: '',
    duration_minutes: '',
    is_active: true
  });

  useEffect(() => {
    if (selectedCompany) {
      loadProducts();
      loadTransactions();
    }
  }, [selectedCompany]);

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
      .limit(50);

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
      selar_link: formData.selar_link || null,
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
      selar_link: product.selar_link || '',
      duration_minutes: product.duration_minutes?.toString() || '',
      is_active: product.is_active
    });
    setIsDialogOpen(true);
  };

  const markAsPaid = async (transactionId: string) => {
    const { error } = await supabase
      .from('payment_transactions')
      .update({
        payment_status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', transactionId);

    if (error) {
      toast.error('Failed to update transaction');
      console.error(error);
    } else {
      toast.success('Payment marked as completed');
      loadTransactions();
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      price: '',
      currency: 'ZMW',
      category: 'video_ad',
      selar_link: '',
      duration_minutes: '',
      is_active: true
    });
    setEditingProduct(null);
    setIsDialogOpen(false);
  };

  const filteredTransactions = transactions.filter(t => 
    filterStatus === 'all' || t.payment_status === filterStatus
  );

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      pending: 'secondary',
      completed: 'default',
      failed: 'destructive',
      cancelled: 'destructive'
    };
    return <Badge variant={variants[status] || 'secondary'}>{status}</Badge>;
  };

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/60">Select a company to manage products & payments</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Products Section */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-white">Products & Services</h2>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => resetForm()}>
                <Plus className="w-4 h-4 mr-2" />
                Add Product
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1A1A1A] border-white/10 max-w-2xl">
              <DialogHeader>
                <DialogTitle className="text-white">
                  {editingProduct ? 'Edit Product' : 'Add New Product'}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label htmlFor="name" className="text-white">Product Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., 30-Second Video Ad"
                      required
                      className="bg-[#0A0A0A] border-white/10 text-white"
                    />
                  </div>
                  
                  <div className="col-span-2">
                    <Label htmlFor="description" className="text-white">Description</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Describe the product..."
                      className="bg-[#0A0A0A] border-white/10 text-white"
                    />
                  </div>

                  <div>
                    <Label htmlFor="price" className="text-white">Price</Label>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                      placeholder="1000"
                      required
                      className="bg-[#0A0A0A] border-white/10 text-white"
                    />
                  </div>

                  <div>
                    <Label htmlFor="currency" className="text-white">Currency</Label>
                    <Select value={formData.currency} onValueChange={(value) => setFormData({ ...formData, currency: value })}>
                      <SelectTrigger className="bg-[#0A0A0A] border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ZMW">ZMW (Kwacha)</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="category" className="text-white">Category</Label>
                    <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                      <SelectTrigger className="bg-[#0A0A0A] border-white/10 text-white">
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
                    <Label htmlFor="duration" className="text-white">Duration (minutes)</Label>
                    <Input
                      id="duration"
                      type="number"
                      value={formData.duration_minutes}
                      onChange={(e) => setFormData({ ...formData, duration_minutes: e.target.value })}
                      placeholder="15, 30, 60"
                      className="bg-[#0A0A0A] border-white/10 text-white"
                    />
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="selar_link" className="text-white">Selar Payment Link (Optional)</Label>
                    <Input
                      id="selar_link"
                      value={formData.selar_link}
                      onChange={(e) => setFormData({ ...formData, selar_link: e.target.value })}
                      placeholder="https://selar.co/..."
                      className="bg-[#0A0A0A] border-white/10 text-white"
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
            <div className="text-white/60 text-center py-8">Loading products...</div>
          ) : products.length === 0 ? (
            <Card className="bg-[#1A1A1A] border-white/10 p-8 text-center">
              <p className="text-white/60">No products yet. Create your first product to start accepting payments!</p>
            </Card>
          ) : (
            products.map((product) => (
              <Card key={product.id} className="bg-[#1A1A1A] border-white/10 p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white">{product.name}</h3>
                    {product.description && (
                      <p className="text-white/60 text-sm mt-1">{product.description}</p>
                    )}
                    <div className="flex gap-4 mt-2 text-sm text-white/80">
                      <span className="font-semibold">{product.currency} {product.price}</span>
                      {product.category && <span className="capitalize">{product.category.replace('_', ' ')}</span>}
                      {product.duration_minutes && <span>{product.duration_minutes} min</span>}
                    </div>
                    {product.selar_link && (
                      <div className="mt-2">
                        <a
                          href={product.selar_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:underline"
                        >
                          Selar Link
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 items-center">
                    <Badge variant={product.is_active ? 'default' : 'secondary'}>
                      {product.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => handleEdit(product)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(product.id)}>
                      <Trash2 className="w-4 h-4 text-red-400" />
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
          <h2 className="text-2xl font-bold text-white">Payment Transactions</h2>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[180px] bg-[#1A1A1A] border-white/10 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="bg-[#1A1A1A] border-white/10">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10">
                <TableHead className="text-white">Date</TableHead>
                <TableHead className="text-white">Customer</TableHead>
                <TableHead className="text-white">Amount</TableHead>
                <TableHead className="text-white">Method</TableHead>
                <TableHead className="text-white">Status</TableHead>
                <TableHead className="text-white">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-white/60 py-8">
                    No transactions found
                  </TableCell>
                </TableRow>
              ) : (
                filteredTransactions.map((transaction) => (
                  <TableRow key={transaction.id} className="border-white/10">
                    <TableCell className="text-white/80">
                      {new Date(transaction.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-white">
                      <div>
                        <div>{transaction.customer_name || 'Unknown'}</div>
                        <div className="text-xs text-white/60">{transaction.customer_phone}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-white font-semibold">
                      {transaction.currency} {transaction.amount}
                    </TableCell>
                    <TableCell className="text-white/80 capitalize">
                      {transaction.payment_method || 'N/A'}
                    </TableCell>
                    <TableCell>{getStatusBadge(transaction.payment_status)}</TableCell>
                    <TableCell>
                      {transaction.payment_status === 'pending' && (
                        <Button
                          size="sm"
                          onClick={() => markAsPaid(transaction.id)}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Mark Paid
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
    </div>
  );
};