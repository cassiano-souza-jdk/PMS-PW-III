import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cn } from './cn';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  readonly required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, children, htmlFor, required = false, ...props }, ref) => {
    return (
      <label
        ref={ref}
        htmlFor={htmlFor}
        className={cn(
          'inline-flex items-center gap-1 text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
          className,
        )}
        {...props}
      >
        <span>{children}</span>
        {required ? (
          <span className="font-semibold text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
    );
  },
);

Label.displayName = 'Label';
