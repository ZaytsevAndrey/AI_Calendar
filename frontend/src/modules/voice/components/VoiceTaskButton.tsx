import React from 'react';
import { Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type VoiceTaskButtonProps = {
  onClick: () => void;
  className?: string;
};

export function VoiceTaskButton({ onClick, className = '' }: VoiceTaskButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ui-btn-secondary w-auto flex-none ${className}`}
      aria-label={t('voice.addByVoice')}
    >
      <Mic className="h-4 w-4" aria-hidden />
      {t('voice.button')}
    </button>
  );
}
