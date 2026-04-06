import React from 'react';

interface ColorFieldProps {
  register: any;
  errors: any;
}

export const ColorField = ({ register, errors }: ColorFieldProps) => {
  return (
    <div className="form-group">
      <label htmlFor="color">Color*</label>
      <div className="color-input-container">
        <input 
          {...register('color')} 
          id="color" 
          type="color"
          className={errors.color ? 'error' : ''} 
        />
        <input 
          {...register('color')} 
          type="text" 
          className={`color-text ${errors.color ? 'error' : ''}`}
        />
      </div>
      {errors.color && <span className="error-message">{errors.color.message}</span>}
    </div>
  );
}; 