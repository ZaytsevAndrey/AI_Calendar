import { dialogButtonSize, responsiveClasses, textControlSize } from './controlSize';
import { controlWidth } from './fieldChrome';

describe('responsiveClasses', () => {
  it('returns one size when the prop is a single step', () => {
    expect(responsiveClasses('sm', textControlSize)).toBe(textControlSize.base.sm);
    expect(responsiveClasses(undefined, textControlSize)).toBe(textControlSize.base.md);
  });

  it('stacks breakpoint overrides without dropping the base size', () => {
    const classes = responsiveClasses({ base: 'sm', md: 'md' }, textControlSize);
    expect(classes.startsWith(textControlSize.base.sm)).toBe(true);
    expect(classes).toContain(textControlSize.md.md);
    expect(classes).not.toContain('sm:h-');
  });

  it('keeps every size touch-sized with 16px text on a phone', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      expect(textControlSize.base[size]).toMatch(/^h-1[12] /);
      expect(textControlSize.base[size]).toContain('text-base');
    }
    expect(responsiveClasses(dialogButtonSize, textControlSize)).toBe(textControlSize.base.md);
  });
});

describe('controlWidth', () => {
  it('keeps an explicit width and still fills when only a max width is set', () => {
    expect(controlWidth('w-24')).toBe('w-24');
    expect(controlWidth('max-w-xs')).toBe('w-full max-w-xs');
    expect(controlWidth()).toBe('w-full');
  });
});
