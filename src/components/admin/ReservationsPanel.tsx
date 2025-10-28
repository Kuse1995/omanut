import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/context/CompanyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export const ReservationsPanel = () => {
  const { selectedCompany } = useCompany();
  const [reservations, setReservations] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, today: 0, thisWeek: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedCompany?.id) return;

    fetchReservations();

    const channel = supabase
      .channel('reservations-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations' },
        () => fetchReservations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedCompany?.id]);

  const fetchReservations = async () => {
    if (!selectedCompany?.id) return;

    setLoading(true);

    const { data } = await supabase
      .from('reservations')
      .select('*')
      .eq('company_id', selectedCompany.id)
      .order('date', { ascending: false })
      .order('time', { ascending: false });

    setReservations(data || []);

    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const total = data?.length || 0;
    const todayCount = data?.filter(r => r.date === today).length || 0;
    const weekCount = data?.filter(r => r.date >= weekAgo).length || 0;

    setStats({ total, today: todayCount, thisWeek: weekCount });
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/60">Loading reservations...</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="bg-[#1A1A1A] border-white/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-white">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{stats.total}</div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1A] border-white/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-white">Today</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-[#84CC16]">{stats.today}</div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1A] border-white/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-white">This Week</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{stats.thisWeek}</div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-[#1A1A1A] border-white/10">
          <CardHeader>
            <CardTitle className="text-white">All Reservations</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  <TableHead className="text-white/60">Name</TableHead>
                  <TableHead className="text-white/60">Phone</TableHead>
                  <TableHead className="text-white/60">Date</TableHead>
                  <TableHead className="text-white/60">Time</TableHead>
                  <TableHead className="text-white/60">Guests</TableHead>
                  <TableHead className="text-white/60">Area</TableHead>
                  <TableHead className="text-white/60">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservations.length === 0 ? (
                  <TableRow className="border-white/10">
                    <TableCell colSpan={7} className="text-center text-white/60">
                      No reservations yet
                    </TableCell>
                  </TableRow>
                ) : (
                  reservations.map((res) => (
                    <TableRow key={res.id} className="border-white/10">
                      <TableCell className="text-white font-medium">{res.name}</TableCell>
                      <TableCell className="text-white">{res.phone}</TableCell>
                      <TableCell className="text-white">{new Date(res.date).toLocaleDateString()}</TableCell>
                      <TableCell className="text-white">{res.time}</TableCell>
                      <TableCell className="text-white">{res.guests}</TableCell>
                      <TableCell className="text-white">{res.area_preference || 'N/A'}</TableCell>
                      <TableCell>
                        <Badge 
                          variant={res.status === 'confirmed' ? 'default' : 'outline'}
                          className={res.status === 'confirmed' ? 'bg-[#84CC16] text-black' : 'border-white/20 text-white'}
                        >
                          {res.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
};
