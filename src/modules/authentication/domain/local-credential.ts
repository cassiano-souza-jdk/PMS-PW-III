import {
  ORGANIZATION_ROLES,
  type IsoDateTime,
  type OrganizationRole,
  type UserId,
} from '@/shared/kernel';

export const PASSWORD_VERIFIER_ALGORITHM = 'SHA-256-SIMULATED' as const;

export type PasswordVerifierAlgorithm = typeof PASSWORD_VERIFIER_ALGORITHM;

/**
 * Simulated local authentication credential decoupled from the `User` aggregate (ADR-0008 §2).
 *
 * Security notice (SECURITY.md, PRD.md §6):
 * Stores only a salted client-side verifier for local prototype simulation.
 * Never stores plaintext passwords and is never exported in User DTOs, audit logs or backups.
 */
export interface LocalCredential {
  readonly userId: UserId;
  readonly email: string;
  readonly passwordVerifier: string;
  readonly salt: string;
  readonly algorithm: PasswordVerifierAlgorithm;
  readonly updatedAt: IsoDateTime;
}

export interface DemoCredentialDescriptor {
  readonly role: OrganizationRole;
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

/**
 * Fictional demonstration credentials for the isolated demo organization (PRD.md §18, ADR-0008 §2.5).
 */
export const DEMO_CREDENTIALS_BY_ROLE: Readonly<
  Record<OrganizationRole, DemoCredentialDescriptor>
> = Object.freeze({
  [ORGANIZATION_ROLES.ADMIN]: Object.freeze({
    role: ORGANIZATION_ROLES.ADMIN,
    email: 'admin.demo@pms.local',
    password: 'DemoAdmin!2026',
    displayName: 'Ana Administradora (Demo)',
  }),
  [ORGANIZATION_ROLES.MANAGER]: Object.freeze({
    role: ORGANIZATION_ROLES.MANAGER,
    email: 'gestor.demo@pms.local',
    password: 'DemoManager!2026',
    displayName: 'Bruno Gestor (Demo)',
  }),
  [ORGANIZATION_ROLES.MEMBER]: Object.freeze({
    role: ORGANIZATION_ROLES.MEMBER,
    email: 'membro.demo@pms.local',
    password: 'DemoMember!2026',
    displayName: 'Carla Membro (Demo)',
  }),
});
