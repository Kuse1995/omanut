import React from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive }) => {
  return (
    <div className="flex items-center justify-center gap-1 h-12">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className={`w-1 bg-primary rounded-full transition-all duration-300 ${
            isActive ? 'animate-pulse' : 'h-2'
          }`}
          style={{
            height: isActive ? `${Math.random() * 40 + 10}px` : '8px',
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  );
};

export default AudioVisualizer;