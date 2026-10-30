import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from 'ui/Input';

interface ColorFieldProps {
  errors: any;
  colorValue?: string;
  setColor: (value: string) => void;
}

export const ColorField = ({ errors, colorValue = '#000000', setColor }: ColorFieldProps) => {
  const { t } = useTranslation();
  return (
    <div className="form-group">
      <label htmlFor="color">{t('phases.colorLabel')}</label>
      <div className="color-input-container">
        <Input
          id="color"
          type="color"
          value={colorValue}
          onChange={(event) => setColor(event.target.value)}
          error={!!errors.color}
        />
        <Input
          id="colorText"
          type="text"
          value={colorValue}
          onChange={(event) => setColor(event.target.value)}
          error={!!errors.color}
          className="color-text"
        />
      </div>
      {errors.color && <span className="error-message">{errors.color.message}</span>}
    </div>
  );
}; 