import { cva, type VariantProps } from 'class-variance-authority';

export const alertVariants = cva(
  'relative w-full rounded-lg border p-4 text-sm [&>svg+div]:translate-y-[-2px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        info: 'border-sky-700/40 bg-sky-50 text-sky-950 dark:border-sky-400/50 dark:bg-sky-950/70 dark:text-sky-50',
        success:
          'border-emerald-700/40 bg-emerald-50 text-emerald-950 dark:border-emerald-400/50 dark:bg-emerald-950/70 dark:text-emerald-50',
        warning:
          'border-amber-700/50 bg-amber-50 text-amber-950 dark:border-amber-400/60 dark:bg-amber-950/70 dark:text-amber-50',
        destructive:
          'border-red-700/50 bg-red-50 text-red-950 dark:border-red-400/60 dark:bg-red-950/80 dark:text-red-50',
      },
    },
    defaultVariants: {
      variant: 'info',
    },
  },
);

export type AlertVariantProps = VariantProps<typeof alertVariants>;
