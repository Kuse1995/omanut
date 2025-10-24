import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { Search } from 'lucide-react';
import BackButton from '@/components/BackButton';

const Reservations = () => {
  const [reservations, setReservations] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ total: 0, today: 0, thisWeek: 0 });

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
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
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
                    <Badge variant={res.status === 'confirmed' ? 'default' : 'secondary'}>
                      {res.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Reservations;