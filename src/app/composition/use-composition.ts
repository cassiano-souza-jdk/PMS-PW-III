import { createContext, useContext } from 'react';
import type { AppCompositionContainer } from './container';

export const CompositionContext = createContext<AppCompositionContainer | null>(null);

export function useComposition(): AppCompositionContainer {
  const container = useContext(CompositionContext);
  if (container === null) {
    throw new Error('useComposition deve ser utilizado dentro de um CompositionProvider.');
  }
  return container;
}
