export type ControlSize = 'sm' | 'md' | 'lg';

/** `base` applies at every width. `sm` / `md` / `lg` override from that Tailwind breakpoint up. */
export type ResponsiveSize =
    | ControlSize
    | {
          base: ControlSize;
          sm?: ControlSize;
          md?: ControlSize;
          lg?: ControlSize;
      };

export type SizeClassSet = {
    base: Record<ControlSize, string>;
    sm: Record<ControlSize, string>;
    md: Record<ControlSize, string>;
    lg: Record<ControlSize, string>;
};

/** Dialog footer actions: 44px on a phone, 36px from the `md` breakpoint. */
export const dialogButtonSize: ResponsiveSize = 'md';

export function responsiveClasses(
    size: ResponsiveSize | undefined,
    set: SizeClassSet,
    fallback: ControlSize = 'md',
): string {
    const resolved = size ?? fallback;
    if (typeof resolved === 'string') {
        return set.base[resolved];
    }
    return [
        set.base[resolved.base],
        resolved.sm ? set.sm[resolved.sm] : '',
        resolved.md ? set.md[resolved.md] : '',
        resolved.lg ? set.lg[resolved.lg] : '',
    ]
        .filter(Boolean)
        .join(' ');
}

/**
 * Phone first: every size is 44px with 16px text below 768px (touch target, no iOS zoom on focus).
 * From 768px: sm 32px / 13px, md 36px / 15px, lg 44px / 16px.
 */
const textBase: Record<ControlSize, string> = {
    sm: 'h-11 min-h-11 px-3.5 text-base md:h-8 md:min-h-8 md:px-3 md:text-body-sm',
    md: 'h-11 min-h-11 px-4 text-base md:h-9 md:min-h-9 md:px-3 md:text-body',
    lg: 'h-12 min-h-12 px-5 text-base md:h-11 md:min-h-11 md:px-4',
};

const textSm: Record<ControlSize, string> = {
    sm: 'sm:h-8 sm:min-h-8 sm:px-3 sm:text-body-sm',
    md: 'sm:h-9 sm:min-h-9 sm:px-3 sm:text-body',
    lg: 'sm:h-11 sm:min-h-11 sm:px-4 sm:text-base',
};

const textMd: Record<ControlSize, string> = {
    sm: 'md:h-8 md:min-h-8 md:px-3 md:text-body-sm',
    md: 'md:h-9 md:min-h-9 md:px-3 md:text-body',
    lg: 'md:h-11 md:min-h-11 md:px-4 md:text-base',
};

const textLg: Record<ControlSize, string> = {
    sm: 'lg:h-8 lg:min-h-8 lg:px-3 lg:text-body-sm',
    md: 'lg:h-9 lg:min-h-9 lg:px-3 lg:text-body',
    lg: 'lg:h-11 lg:min-h-11 lg:px-4 lg:text-base',
};

export const textControlSize: SizeClassSet = {
    base: textBase,
    sm: textSm,
    md: textMd,
    lg: textLg,
};

const iconBase: Record<ControlSize, string> = {
    sm: 'h-11 w-11 md:h-8 md:w-8',
    md: 'h-11 w-11 md:h-9 md:w-9',
    lg: 'h-12 w-12 md:h-11 md:w-11',
};

const iconSm: Record<ControlSize, string> = {
    sm: 'sm:h-8 sm:w-8',
    md: 'sm:h-11 sm:w-11',
    lg: 'sm:h-12 sm:w-12',
};

const iconMd: Record<ControlSize, string> = {
    sm: 'md:h-8 md:w-8',
    md: 'md:h-9 md:w-9',
    lg: 'md:h-11 md:w-11',
};

const iconLg: Record<ControlSize, string> = {
    sm: 'lg:h-8 lg:w-8',
    md: 'lg:h-11 lg:w-11',
    lg: 'lg:h-12 lg:w-12',
};

export const iconControlSize: SizeClassSet = {
    base: iconBase,
    sm: iconSm,
    md: iconMd,
    lg: iconLg,
};

const areaBase: Record<ControlSize, string> = {
    sm: 'min-h-[4.5rem] px-3 py-2 text-base md:px-2.5 md:py-1.5 md:text-body-sm',
    md: 'min-h-[5.5rem] px-3 py-2.5 text-base md:text-body',
    lg: 'min-h-[7rem] px-3.5 py-3 text-base',
};

const areaSm: Record<ControlSize, string> = {
    sm: 'sm:min-h-[4.5rem] sm:px-2.5 sm:py-1.5 sm:text-body-sm',
    md: 'sm:min-h-[5.5rem] sm:px-3 sm:py-2.5 sm:text-body',
    lg: 'sm:min-h-[7rem] sm:px-3.5 sm:py-3 sm:text-base',
};

const areaMd: Record<ControlSize, string> = {
    sm: 'md:min-h-[4.5rem] md:px-2.5 md:py-1.5 md:text-body-sm',
    md: 'md:min-h-[5.5rem] md:px-3 md:py-2.5 md:text-body',
    lg: 'md:min-h-[7rem] md:px-3.5 md:py-3 md:text-base',
};

const areaLg: Record<ControlSize, string> = {
    sm: 'lg:min-h-[4.5rem] lg:px-2.5 lg:py-1.5 lg:text-body-sm',
    md: 'lg:min-h-[5.5rem] lg:px-3 lg:py-2.5 lg:text-body',
    lg: 'lg:min-h-[7rem] lg:px-3.5 lg:py-3 lg:text-base',
};

export const areaControlSize: SizeClassSet = {
    base: areaBase,
    sm: areaSm,
    md: areaMd,
    lg: areaLg,
};

const iconGlyph: Record<ControlSize, string> = {
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
};

/** Lucide glyph inside a field. Separate from the icon-button hit target. */
export const fieldIconSize: SizeClassSet = {
    base: iconGlyph,
    sm: {
        sm: 'sm:h-3.5 sm:w-3.5',
        md: 'sm:h-4 sm:w-4',
        lg: 'sm:h-5 sm:w-5',
    },
    md: {
        sm: 'md:h-3.5 md:w-3.5',
        md: 'md:h-4 md:w-4',
        lg: 'md:h-5 md:w-5',
    },
    lg: {
        sm: 'lg:h-3.5 lg:w-3.5',
        md: 'lg:h-4 lg:w-4',
        lg: 'lg:h-5 lg:w-5',
    },
};

/** Clears the trailing icon. `!` wins over the horizontal padding in `textControlSize`. */
export const fieldTrailingPad: SizeClassSet = {
    base: { sm: '!pr-8', md: '!pr-10', lg: '!pr-11' },
    sm: { sm: 'sm:!pr-8', md: 'sm:!pr-10', lg: 'sm:!pr-11' },
    md: { sm: 'md:!pr-8', md: 'md:!pr-10', lg: 'md:!pr-11' },
    lg: { sm: 'lg:!pr-8', md: 'lg:!pr-10', lg: 'lg:!pr-11' },
};

/** Lucide glyph inside a labeled button. */
export const buttonGlyphSize: SizeClassSet = {
    base: {
        sm: '[&_svg]:h-3.5 [&_svg]:w-3.5',
        md: '[&_svg]:h-4 [&_svg]:w-4',
        lg: '[&_svg]:h-5 [&_svg]:w-5',
    },
    sm: {
        sm: 'sm:[&_svg]:h-3.5 sm:[&_svg]:w-3.5',
        md: 'sm:[&_svg]:h-4 sm:[&_svg]:w-4',
        lg: 'sm:[&_svg]:h-5 sm:[&_svg]:w-5',
    },
    md: {
        sm: 'md:[&_svg]:h-3.5 md:[&_svg]:w-3.5',
        md: 'md:[&_svg]:h-4 md:[&_svg]:w-4',
        lg: 'md:[&_svg]:h-5 md:[&_svg]:w-5',
    },
    lg: {
        sm: 'lg:[&_svg]:h-3.5 lg:[&_svg]:w-3.5',
        md: 'lg:[&_svg]:h-4 lg:[&_svg]:w-4',
        lg: 'lg:[&_svg]:h-5 lg:[&_svg]:w-5',
    },
};

export const fieldLeadingPad: SizeClassSet = {
    base: { sm: '!pl-8', md: '!pl-10', lg: '!pl-11' },
    sm: { sm: 'sm:!pl-8', md: 'sm:!pl-10', lg: 'sm:!pl-11' },
    md: { sm: 'md:!pl-8', md: 'md:!pl-10', lg: 'md:!pl-11' },
    lg: { sm: 'lg:!pl-8', md: 'lg:!pl-10', lg: 'lg:!pl-11' },
};
