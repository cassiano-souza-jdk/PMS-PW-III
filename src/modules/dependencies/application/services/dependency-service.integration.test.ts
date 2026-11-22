import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppContainer, type AppCompositionContainer } from '@/app/composition';
import { InMemoryEphemeralSessionPointer } from '@/modules/authentication/infrastructure/session/ephemeral-session-pointer';
import { asOrganizationMemberId } from '@/modules/organizations';
import { PROJECT_MEMBER_ROLES } from '@/modules/projects';
import { AuthorizationError, ConflictError } from '@/shared/errors';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  asIsoDateTime,
  type IsoDateTime,
} from '@/shared/kernel';
import { PMS_DATABASE_NAME, ensureDatabaseOpen } from '@/shared/persistence';

describe('DependencyService Integration (Acyclic Graph, Duplicate Pair, Scope Filtering & §12.1)', () => {
  let container: AppCompositionContainer;
  let currentNow: IsoDateTime;

  beforeEach(async () => {
    currentNow = asIsoDateTime('2026-07-10T10:00:00.000Z');
    container = createAppContainer({
      ephemeralSessionPointer: new InMemoryEphemeralSessionPointer(),
      now: () => currentNow,
      dbOptions: {
        databaseName: `${PMS_DATABASE_NAME}_deps_${crypto.randomUUID()}`,
        indexedDB: new IDBFactory(),
        IDBKeyRange,
      },
    });
    await ensureDatabaseOpen(container.db);
  });

  afterEach(async () => {
    if (container.db.isOpen()) {
      container.db.close();
    }
    await container.db.delete();
  });

  async function registerUser(email: string, displayName: string) {
    return container.services.auth.registerUser({
      email,
      password: 'PasswordForte!2026',
      displayName,
      acceptTerms: true,
      persistent: true,
    });
  }

  async function setupFixture() {
    const admin = await registerUser('admin.deps@pms.local', 'Admin Deps');
    const manager = await registerUser('manager.deps@pms.local', 'Manager Deps');
    const member = await registerUser('member.deps@pms.local', 'Member Deps');
    const otherMember = await registerUser('other.deps@pms.local', 'Other Deps');

    const { organization } = await container.services.organizations.createOrganization(
      admin.user.id,
      { name: 'Deps Org', slug: 'deps-org' },
    );

    for (const [userId, role] of [
      [manager.user.id, ORGANIZATION_ROLES.MANAGER],
      [member.user.id, ORGANIZATION_ROLES.MEMBER],
      [otherMember.user.id, ORGANIZATION_ROLES.MEMBER],
    ] as const) {
      await container.repositories.organizations.organizationMembers.save({
        id: asOrganizationMemberId(crypto.randomUUID()),
        organizationId: organization.id,
        userId,
        role,
        status: MEMBERSHIP_STATUSES.ACTIVE,
        joinedAt: currentNow,
        updatedAt: currentNow,
      });
    }

    const projectA = await container.services.projects.createProject(
      admin.user.id,
      organization.id,
      { name: 'Projeto A', ownerUserId: manager.user.id },
    );
    const projectB = await container.services.projects.createProject(
      admin.user.id,
      organization.id,
      { name: 'Projeto B', ownerUserId: manager.user.id },
    );

    await container.services.projects.addProjectParticipant(
      manager.user.id,
      organization.id,
      projectA.id,
      member.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );
    await container.services.projects.addProjectParticipant(
      manager.user.id,
      organization.id,
      projectA.id,
      otherMember.user.id,
      PROJECT_MEMBER_ROLES.PARTICIPANT,
    );

    return { admin, manager, member, otherMember, organization, projectA, projectB };
  }

  it('impede auto-dependência, ciclo direto/indireto, duplicidade, cross-project e cross-org, e preserva lastMovedAt', async () => {
    const { admin, manager, member, organization, projectA, projectB } = await setupFixture();

    const task1 = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      { title: 'Tarefa 1', assigneeId: member.user.id },
    );
    const task2 = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      { title: 'Tarefa 2', assigneeId: member.user.id },
    );
    const task3 = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectA.id,
      { title: 'Tarefa 3', assigneeId: manager.user.id },
    );
    const taskOtherProject = await container.services.tasks.createTask(
      manager.user.id,
      organization.id,
      projectB.id,
      { title: 'Tarefa Projeto B' },
    );

    // MEMBER sem grant DEPENDENCY_MANAGE é bloqueado
    await expect(
      container.services.dependencies.addDependency(member.user.id, organization.id, task1.id, {
        dependsOnTaskId: task2.id,
      }),
    ).rejects.toThrowError(AuthorizationError);

    // Auto-dependência
    await expect(
      container.services.dependencies.addDependency(manager.user.id, organization.id, task1.id, {
        dependsOnTaskId: task1.id,
      }),
    ).rejects.toThrowError(ConflictError);

    // Cross-project bloqueado
    await expect(
      container.services.dependencies.addDependency(manager.user.id, organization.id, task1.id, {
        dependsOnTaskId: taskOtherProject.id,
      }),
    ).rejects.toThrowError(ConflictError);

    // Adiciona 1 -> 2 e 2 -> 3 em instante posterior
    const t2 = asIsoDateTime('2026-07-11T12:00:00.000Z');
    currentNow = t2;

    const dep12 = await container.services.dependencies.addDependency(
      manager.user.id,
      organization.id,
      task1.id,
      { dependsOnTaskId: task2.id, required: true },
    );
    await container.services.dependencies.addDependency(
      manager.user.id,
      organization.id,
      task2.id,
      {
        dependsOnTaskId: task3.id,
        required: true,
      },
    );

    // Verifica lastActivityAt atualizado preservando lastMovedAt
    const refreshedTask1 = await container.repositories.tasks.tasks.findById(
      organization.id,
      task1.id,
    );
    expect(refreshedTask1?.lastMovedAt).toBe(task1.lastMovedAt);
    expect(refreshedTask1?.lastActivityAt).toBe(t2);

    // Duplicidade 1 -> 2 via findByPair
    await expect(
      container.services.dependencies.addDependency(manager.user.id, organization.id, task1.id, {
        dependsOnTaskId: task2.id,
      }),
    ).rejects.toThrowError(ConflictError);

    // Ciclo direto (2 -> 1) e ciclo indireto (3 -> 1) bloqueados
    await expect(
      container.services.dependencies.addDependency(manager.user.id, organization.id, task2.id, {
        dependsOnTaskId: task1.id,
      }),
    ).rejects.toThrowError(ConflictError);

    await expect(
      container.services.dependencies.addDependency(manager.user.id, organization.id, task3.id, {
        dependsOnTaskId: task1.id,
      }),
    ).rejects.toThrowError(ConflictError);

    // Visibilidade DEPENDENCY_VIEW: task2 tem aresta para task1 (acessível ao member) e para task3 (manager-only, fora do escopo do member!)
    // Logo member vê apenas a dependência com task1 e NUNCA recebe título/estado de task3; ADMIN vê ambas!
    const memberVisibleDeps = await container.services.dependencies.listTaskDependencies(
      member.user.id,
      organization.id,
      task2.id,
    );
    expect(memberVisibleDeps).toHaveLength(1);
    expect(memberVisibleDeps[0]?.relatedTask.id).toBe(task1.id);
    expect(memberVisibleDeps[0]?.relatedTask.title).toBe('Tarefa 1');

    const adminVisibleDeps = await container.services.dependencies.listTaskDependencies(
      admin.user.id,
      organization.id,
      task2.id,
    );
    expect(adminVisibleDeps).toHaveLength(2);
    expect(adminVisibleDeps.map((d) => d.relatedTask.id).sort()).toEqual(
      [task1.id, task3.id].sort(),
    );

    // Isolamento cross-org: usuário de outra organização bloqueado
    const outsider = await registerUser('outsider.deps@pms.local', 'Outsider');
    await container.services.organizations.createOrganization(outsider.user.id, {
      name: 'Other Org',
      slug: 'other-org-deps',
    });
    await expect(
      container.services.dependencies.listTaskDependencies(
        outsider.user.id,
        organization.id,
        task1.id,
      ),
    ).rejects.toThrowError(AuthorizationError);

    // Remoção preserva lastMovedAt e atualiza lastActivityAt
    const t3 = asIsoDateTime('2026-07-12T15:00:00.000Z');
    currentNow = t3;
    const removed = await container.services.dependencies.removeDependency(
      manager.user.id,
      organization.id,
      task1.id,
      dep12.id,
    );
    expect(removed.deletedDependencyId).toBe(dep12.id);

    const task1AfterRemove = await container.repositories.tasks.tasks.findById(
      organization.id,
      task1.id,
    );
    expect(task1AfterRemove?.lastMovedAt).toBe(task1.lastMovedAt);
    expect(task1AfterRemove?.lastActivityAt).toBe(t3);
  });
});
