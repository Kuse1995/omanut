import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Home } from 'lucide-react';

interface BackButtonProps {
  showHome?: boolean;
}

const BackButton = ({ showHome = true }: BackButtonProps) => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-2 mb-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(-1)}
        className="gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>
      {showHome && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          className="gap-2"
        >
          <Home className="h-4 w-4" />
          Home
        </Button>
      )}
    </div>
  );
};

export default BackButton;
