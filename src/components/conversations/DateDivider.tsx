import { format, isToday, isYesterday } from 'date-fns';

interface DateDividerProps {
  date: string;
}

export const DateDivider = ({ date }: DateDividerProps) => {
  const dateObj = new Date(date);
  
  const getDateLabel = () => {
    if (isToday(dateObj)) return 'Today';
    if (isYesterday(dateObj)) return 'Yesterday';
    return format(dateObj, 'MMMM d, yyyy');
  };

  return (
    <div className="flex items-center justify-center my-4">
      <div className="text-xs text-muted-foreground bg-muted/80 px-3 py-1.5 rounded-full font-medium shadow-sm">
        {getDateLabel()}
      </div>
    </div>
  );
};
