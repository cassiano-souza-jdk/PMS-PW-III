import { IconX } from '@tabler/icons-react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from './button';
import { cn } from './cn';

export interface ModalDialogProps {
  readonly isOpen: boolean;
  readonly titleId: string;
  readonly title: string;
  readonly descriptionId?: string;
  readonly description?: string;
  readonly closeLabel: string;
  readonly isBusy?: boolean;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly className?: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function ModalDialog({
  isOpen,
  titleId,
  title,
  descriptionId,
  description,
  closeLabel,
  isBusy = false,
  initialFocusRef,
  className,
  onClose,
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const isBusyRef = useRef<boolean>(isBusy);
  const onCloseRef = useRef<() => void>(onClose);

  useEffect(() => {
    isBusyRef.current = isBusy;
    onCloseRef.current = onClose;
  }, [isBusy, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousFocused =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const dialogNode = dialogRef.current;
    if (dialogNode !== null) {
      const preferredTarget = initialFocusRef?.current;
      if (
        preferredTarget !== null &&
        preferredTarget !== undefined &&
        dialogNode.contains(preferredTarget)
      ) {
        preferredTarget.focus();
      } else {
        const firstFocusable = dialogNode.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        if (firstFocusable !== null) {
          firstFocusable.focus();
        } else {
          dialogNode.focus();
        }
      }
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!isBusyRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== 'Tab' || dialogNode === null) {
        return;
      }

      const focusables = Array.from(dialogNode.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        event.preventDefault();
        dialogNode.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }

      if (event.shiftKey) {
        if (document.activeElement === first || document.activeElement === dialogNode) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialogNode?.addEventListener('keydown', handleKeyDown);

    return () => {
      dialogNode?.removeEventListener('keydown', handleKeyDown);
      if (previousFocused !== null && previousFocused.isConnected) {
        previousFocused.focus();
      }
    };
  }, [initialFocusRef, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isBusy) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description !== undefined ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-6 text-card-foreground shadow-xl focus:outline-none',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b pb-3">
          <div className="space-y-1">
            <h2 id={titleId} className="text-lg font-semibold leading-snug text-foreground">
              {title}
            </h2>
            {description !== undefined ? (
              <p id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-h-[44px] min-w-[44px] shrink-0"
            aria-label={closeLabel}
            disabled={isBusy}
            onClick={onClose}
          >
            <IconX className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
