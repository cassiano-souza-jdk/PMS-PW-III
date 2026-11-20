import { forwardRef, type HTMLAttributes } from 'react';
import { alertVariants, type AlertVariantProps } from './alert-variants';
import { cn } from './cn';

export interface AlertProps extends HTMLAttributes<HTMLDivElement>, AlertVariantProps {
  readonly role?: 'status' | 'alert';
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = 'info', role, 'aria-live': ariaLive, ...props }, ref) => {
    const resolvedRole =
      role ?? (variant === 'destructive' || variant === 'warning' ? 'alert' : 'status');
    const resolvedAriaLive = ariaLive ?? (resolvedRole === 'alert' ? 'assertive' : 'polite');

    return (
      <div
        ref={ref}
        role={resolvedRole}
        aria-live={resolvedAriaLive}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      />
    );
  },
);

Alert.displayName = 'Alert';

export const AlertTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('mb-1 font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  ),
);

AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('text-sm leading-relaxed [&_p]:leading-relaxed', className)}
      {...props}
    />
  ),
);

AlertDescription.displayName = 'AlertDescription';
