import { createContext, useContext } from 'react';
import type {
  CreateOrganizationInput,
  CreateOrganizationResult,
  MyOrganizationSummary,
} from '@/modules/organizations';
import type { OrganizationId } from '@/shared/kernel';

export interface OrganizationContextValue {
  readonly organizations: readonly MyOrganizationSummary[];
  readonly activeOrganization: MyOrganizationSummary | null;
  readonly activeOrganizationId: OrganizationId | null;
  readonly isLoading: boolean;
  readonly isDemoOrganization: boolean;
  readonly selectOrganization: (organizationId: OrganizationId) => void;
  readonly refreshOrganizations: () => Promise<readonly MyOrganizationSummary[]>;
  readonly createOrganization: (
    input: CreateOrganizationInput,
  ) => Promise<CreateOrganizationResult>;
  readonly leaveOrganization: (organizationId: OrganizationId) => Promise<void>;
}

export const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export function useOrganization(): OrganizationContextValue {
  const context = useContext(OrganizationContext);
  if (context === null) {
    throw new Error('useOrganization deve ser utilizado dentro de um OrganizationProvider.');
  }
  return context;
}
