import { createContext, useContext } from 'react';
import type {
  AuthorizationDecision,
  AuthorizationResource,
  AuthorizationScopeSummary,
  ExplicitDenyRule,
  PermissionCode,
  PermissionGrant,
} from '@/modules/authorization';

export type PermissionResourceOverrides = Partial<AuthorizationResource>;

/**
 * Contexto auxiliar de UX para visibilidade/habilitação de controles na interface.
 *
 * IMPORTANTE (ADR-0008 / ADR-0009 / PERMISSIONS.md): ocultar ou desabilitar controles na UI
 * nunca substitui a autorização real; todos os casos de uso de aplicação aplicam
 * `assertAuthorized(...)` antes de executar qualquer leitura protegida ou mutação.
 */
export interface PermissionContextValue {
  readonly can: (
    permission: PermissionCode,
    resourceOverrides?: PermissionResourceOverrides,
  ) => boolean;
  readonly evaluate: (
    permission: PermissionCode,
    resourceOverrides?: PermissionResourceOverrides,
  ) => AuthorizationDecision;
  readonly refreshPermissions: () => Promise<void>;
  readonly isLoadingPermissions: boolean;
  readonly activeGrants: readonly PermissionGrant[];
  readonly activeDenyRules: readonly ExplicitDenyRule[];
  readonly scopeSummary: AuthorizationScopeSummary;
}

export const PermissionContext = createContext<PermissionContextValue | null>(null);

export function usePermission(): PermissionContextValue {
  const context = useContext(PermissionContext);
  if (context === null) {
    throw new Error('usePermission deve ser utilizado dentro de um PermissionProvider.');
  }
  return context;
}
