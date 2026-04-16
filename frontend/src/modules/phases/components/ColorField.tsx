import React from 'react';

interface ColorFieldProps {
  errors: any;
  colorValue?: string;
  setColor: (value: string) => void;
}

export const ColorField = ({ errors, colorValue = '#000000', setColor }: ColorFieldProps) => {
  return (
    <div className="form-group">
      <label htmlFor="color">Color*</label>
      <div className="color-input-container">
        <input 
          id="color" 
          type="color"
          value={colorValue}
          onChange={(event) => setColor(event.target.value)}
          className={errors.color ? 'error' : ''} 
        />
        <input 
          id="colorText"
          type="text" 
          value={colorValue}
          onChange={(event) => setColor(event.target.value)}
          className={`color-text ${errors.color ? 'error' : ''}`}
        />
      </div>
      {errors.color && <span className="error-message">{errors.color.message}</span>}
    </div>
  );
}; 