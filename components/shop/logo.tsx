import { cn } from '@/lib/utils';
import { LOGO_PATHS } from '@/components/shop/logo-paths';

export type LogoVariant = keyof typeof LOGO_PATHS;

interface LogoProps {
  variant?: LogoVariant;
  className?: string;
}

/** Logo Meritt Home en SVG inline : la couleur suit `currentColor` (text-foreground, text-white…). */
export function Logo({ variant = 'horizontal', className }: LogoProps) {
  const { viewBox, d } = LOGO_PATHS[variant];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      fill="currentColor"
      role="img"
      aria-label="Meritt Home"
      className={cn('block h-7 w-auto shrink-0', className)}
    >
      {d.map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  );
}
