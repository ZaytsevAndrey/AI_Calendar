import React from 'react';
import { Mic } from 'lucide-react';

type VoiceTaskButtonProps = {
  onClick: () => void;
  className?: string;
};

export function VoiceTaskButton({ onClick, className = '' }: VoiceTaskButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ui-btn-secondary min-w-[9rem] flex-1 sm:w-auto sm:flex-none ${className}`}
      aria-label="Add task by voice"
    >
      <Mic className="h-4 w-4" aria-hidden />
      Voice
    </button>
  );
}
