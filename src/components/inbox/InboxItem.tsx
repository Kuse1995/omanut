import { ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface InboxItemProps {
  type: 'message' | 'comment';
  sender: string;
  content: string;
  timestamp: string;
  statusBadge: ReactNode;
  isSelected: boolean;
  onClick: () => void;
}

export function InboxItem({
  type,
  sender,
  content,
  timestamp,
  statusBadge,
  isSelected,
  onClick,
}: InboxItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-4 transition-colors hover:bg-muted/50",
        isSelected && "bg-muted"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm truncate">{sender}</span>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(timestamp), { addSuffix: true })}
            </span>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {content || `[${type === 'message' ? 'Media message' : 'Empty comment'}]`}
          </p>
        </div>
        <div className="flex-shrink-0">
          {statusBadge}
        </div>
      </div>
    </button>
  );
}
