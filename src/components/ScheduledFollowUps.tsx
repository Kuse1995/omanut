import { Clock, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function ScheduledFollowUps() {
  const schedules = [
    {
      name: 'Morning Engagement',
      time: '9:00 AM',
      description: 'Catch customers during early hours when they check messages',
      status: 'active'
    },
    {
      name: 'Afternoon Check-in',
      time: '2:00 PM',
      description: 'Re-engage during post-lunch break when people are most responsive',
      status: 'active'
    },
    {
      name: 'Evening Follow-up',
      time: '6:00 PM',
      description: 'Connect with customers after work hours for casual browsing',
      status: 'active'
    }
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Automated Follow-Up Schedule
            </CardTitle>
            <CardDescription>
              AI analyzes conversations and sends strategic follow-ups at optimal times daily
            </CardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <CheckCircle className="h-3 w-3" />
            Active
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {schedules.map((schedule) => (
          <div
            key={schedule.name}
            className="flex items-start gap-4 p-4 border rounded-lg bg-muted/30"
          >
            <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold">{schedule.name}</h4>
                <Badge variant="outline" className="text-xs">
                  {schedule.time}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{schedule.description}</p>
            </div>
          </div>
        ))}
        
        <div className="mt-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
          <p className="text-sm text-muted-foreground">
            <strong>How it works:</strong> The Supervisor AI analyzes recent conversations (last 3 days), 
            identifies conversion opportunities, researches customer context, and guides the main AI to craft 
            personalized follow-up messages that drive sales and bookings.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
