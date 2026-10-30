import React from 'react';
import { useTranslation } from 'react-i18next';
import { PhaseColorPicker } from 'ui/PhaseColorPicker';

interface ColorFieldProps {
  errors: any;
  colorValue?: string;
  setColor: (value: string) => void;
}

export const ColorField = ({ errors, colorValue, setColor }: ColorFieldProps) => {
  const { t } = useTranslation();
  return (
    <div className="form-group">
      <span id="phase-color-label" className="mb-1.5 block text-body-sm font-medium text-ide-muted">
        {t('phases.colorLabel')}
      </span>
      <PhaseColorPicker id="phase-color" labelledBy="phase-color-label" value={colorValue} onChange={setColor} />
      {errors.color && <span className="error-message">{errors.color.message}</span>}
    </div>
  );
};
