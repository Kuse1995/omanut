import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { Search, Edit, X } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { useToast } from '@/hooks/use-toast';

const Reservations = () => {
  const { toast } = useToast();
  const [reservations, setReservations] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ total: 0, today: 0, thisWeek: 0 });
  const [editingReservation, setEditingReservation] = useState<any>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    fetchReservations();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('reservations-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reservations'
        },
        () => fetchReservations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchReservations = async () => {
    // Get current user's company
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: userData } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', session.user.id)
      .single();

    if (!userData?.company_id) return;

    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('company_id', userData.company_id)
      .order('date', { ascending: false })
      .order('time', { ascending: false });

    if (error) {
      console.error('Error fetching reservations:', error);
      return;
    }

    setReservations(data || []);

    // Calculate stats
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const total = data?.length || 0;
    const todayCount = data?.filter(r => r.date === today).length || 0;
    const weekCount = data?.filter(r => r.date >= weekAgo).length || 0;

    setStats({ total, today: todayCount, thisWeek: weekCount });
  };

  const filteredReservations = reservations.filter(res =>
    res.name?.toLowerCase().includes(search.toLowerCase()) ||
    res.phone?.includes(search)
  );

  const handleEdit = (reservation: any) => {
    setEditingReservation({ ...reservation });
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingReservation) return;

    try {
      const { error } = await supabase.functions.invoke('update-reservation', {
        body: {
          reservationId: editingReservation.id,
          action: 'update',
          updates: {
            name: editingReservation.name,
            phone: editingReservation.phone,
            email: editingReservation.email,
            date: editingReservation.date,
            time: editingReservation.time,
            guests: editingReservation.guests,
            area_preference: editingReservation.area_preference,
            occasion: editingReservation.occasion,
          },
          notifyCustomer: true,
        }
      });

      if (error) throw error;

      toast({
        title: 'Reservation updated',
        description: 'Customer has been notified of the changes.',
      });

      setIsEditDialogOpen(false);
      fetchReservations();
    } catch (error) {
      console.error('Error updating reservation:', error);
      toast({
        title: 'Error',
        description: 'Failed to update reservation',
        variant: 'destructive',
      });
    }
  };

  const handleCancel = async (reservation: any) => {
    if (!confirm(`Cancel reservation for ${reservation.name}?`)) return;

    setIsCancelling(true);
    try {
      const { error } = await supabase.functions.invoke('update-reservation', {
        body: {
          reservationId: reservation.id,
          action: 'cancel',
          notifyCustomer: true,
        }
      });

      if (error) throw error;

      toast({
        title: 'Reservation cancelled',
        description: 'Customer has been notified.',
      });

      fetchReservations();
    } catch (error) {
      console.error('Error cancelling reservation:', error);
      toast({
        title: 'Error',
        description: 'Failed to cancel reservation',
        variant: 'destructive',
      });
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="p-8 space-y-8">
      <BackButton />
      <div>
        <h1 className="text-3xl font-bold mb-2">Reservations</h1>
        <p className="text-muted-foreground">Manage all bookings</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Reservations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Reservations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{stats.today}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.thisWeek}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Guests</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Occasion</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReservations.map((res) => (
                <TableRow key={res.id}>
                  <TableCell className="font-medium">{res.name}</TableCell>
                  <TableCell>{res.phone}</TableCell>
                  <TableCell>{new Date(res.date).toLocaleDateString()}</TableCell>
                  <TableCell>{res.time}</TableCell>
                  <TableCell>{res.guests}</TableCell>
                  <TableCell>{res.area_preference || 'N/A'}</TableCell>
                  <TableCell>{res.occasion || 'N/A'}</TableCell>
                  <TableCell>
                    <Badge variant={res.status === 'confirmed' ? 'default' : res.status === 'cancelled' ? 'destructive' : 'secondary'}>
                      {res.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(res)}
                        disabled={res.status === 'cancelled'}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleCancel(res)}
                        disabled={res.status === 'cancelled' || isCancelling}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Reservation</DialogTitle>
            <DialogDescription>
              Update reservation details. Customer will be notified of changes.
            </DialogDescription>
          </DialogHeader>

          {editingReservation && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    value={editingReservation.name}
                    onChange={(e) => setEditingReservation({ ...editingReservation, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-phone">Phone</Label>
                  <Input
                    id="edit-phone"
                    value={editingReservation.phone}
                    onChange={(e) => setEditingReservation({ ...editingReservation, phone: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editingReservation.email || ''}
                  onChange={(e) => setEditingReservation({ ...editingReservation, email: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-date">Date</Label>
                  <Input
                    id="edit-date"
                    type="date"
                    value={editingReservation.date}
                    onChange={(e) => setEditingReservation({ ...editingReservation, date: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-time">Time</Label>
                  <Input
                    id="edit-time"
                    type="time"
                    value={editingReservation.time}
                    onChange={(e) => setEditingReservation({ ...editingReservation, time: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-guests">Guests</Label>
                  <Input
                    id="edit-guests"
                    type="number"
                    value={editingReservation.guests}
                    onChange={(e) => setEditingReservation({ ...editingReservation, guests: parseInt(e.target.value) })}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-area">Area Preference</Label>
                  <Input
                    id="edit-area"
                    value={editingReservation.area_preference || ''}
                    onChange={(e) => setEditingReservation({ ...editingReservation, area_preference: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="edit-occasion">Occasion</Label>
                <Input
                  id="edit-occasion"
                  value={editingReservation.occasion || ''}
                  onChange={(e) => setEditingReservation({ ...editingReservation, occasion: e.target.value })}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Reservations;