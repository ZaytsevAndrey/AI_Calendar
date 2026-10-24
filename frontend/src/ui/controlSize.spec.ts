import { dialogButtonSize, responsiveClasses, textControlSize } from './controlSize';
import { controlWidth } from './fieldChrome';

describe('responsiveClasses', () => {
  it('returns one size when the prop is a single step', () => {
    expect(responsiveClasses('sm', textControlSize)).toBe(textControlSize.base.sm);
    expect(responsiveClasses(undefined, textControlSize)).toBe(textControlSize.base.md);
  });

  it('stacks breakpoint overrides without dropping the base size', () => {
    const classes = responsiveClasses(dialogButtonSize, textControlSize);
    expect(classes.startsWith(textControlSize.base.sm)).toBe(true);
    expect(classes).toContain(textControlSize.md.md);
    expect(classes).not.toContain('sm:h-');
  });
});

describe('controlWidth', () => {
  it('keeps an explicit width and still fills when only a max width is set', () => {
    expect(controlWidth('w-24')).toBe('w-24');
    expect(controlWidth('max-w-xs')).toBe('w-full max-w-xs');
    expect(controlWidth()).toBe('w-full');
  });
});
