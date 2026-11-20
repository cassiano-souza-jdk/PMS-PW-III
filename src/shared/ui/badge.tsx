import { forwardRef, type HTMLAttributes } from 'react';
import { badgeVariants, type BadgeVariantProps } from './badge-variants';
import { cn } from './cn';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, BadgeVariantProps {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
  },
);

Badge.displayName = 'Badge';
