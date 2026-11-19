import { useMemo, type ReactNode } from 'react';
import { createAppContainer, type AppCompositionContainer } from './container';
import { CompositionContext } from './use-composition';

export interface CompositionProviderProps {
  readonly container?: AppCompositionContainer;
  readonly children: ReactNode;
}

export function CompositionProvider({ container, children }: CompositionProviderProps) {
  const resolvedContainer = useMemo(() => container ?? createAppContainer(), [container]);

  return (
    <CompositionContext.Provider value={resolvedContainer}>{children}</CompositionContext.Provider>
  );
}
