# ADR-0009 --- Arquitetura de Convites, Equipes e Gestão de Permissões (RBAC + ABAC)

- **Status:** Aceita
- **Data:** 2026-11-20
- **Fase:** 05 — Convites, Equipes e Permissões
- **Responsáveis:** Arquiteto de Software (redação) / PMS Orchestrator (aprovação)
- **Referências normativas:** `PRD.md` (§7.2, §7.3, §17, §24), `PERMISSIONS.md`, `SECURITY.md`, `ARCHITECTURE.md`, `DOMAIN.md`, `ACCESSIBILITY.md`, `CODING-STANDARDS.md`, `ADR-0001..0008`, `docs/contracts/permission-matrix.md` (§5.1, §5.2, §6–§12), `docs/contracts/api-endpoints.md`, `docs/contracts/event-envelope.md`.

## Contexto

Com a fundação técnica, o motor RBAC + ABAC puro, a persistência Dexie v4 (Schema v2 / 51 tabelas), a simulação MSW v2 e os fluxos completos de Autenticação, Usuários e Organizações concluídos nas Fases 01–04 (`ADR-0004..0008`), a Fase 05 entrega os fluxos de **Convites organizacionais**, **Gestão de Equipes e Membros (N:N)** e **Gestão de Permissões Adicionais (`PermissionGrant`) e Negações Explícitas (`ExplicitDenyRule` / *Deny Overrides*)**.

Para preservar rigorosamente as fronteiras mecânicas do `eslint.config.js` (especialmente o status de módulo-folha de `src/modules/authorization/**`), impedir apropriação de convites nominais, garantir integridade referencial e revogação imediata de permissões em operações de equipe, e manter paridade entre UI e motor RBAC + ABAC, quatro decisões arquiteturais precisam ser formalizadas:

1. Topologia de `AuthorizationManagementService` sem violar a regra de módulo-folha de `src/modules/authorization/**`.
2. Política de segurança para pré-visualização e aceitação de convites nominais (`InvitationService`).
3. Invariantes transacionais de exclusão lógica de equipe (`deleteTeam`) e remoção de membro de equipe (`removeTeamMember`).
4. Sincronização completa de regras e escopos ativos no `PermissionProvider`, mantendo zero novas dependências NPM e zero alteração do Schema Dexie v2.

## Decisão

### 1. Preservação do Módulo-Folha `authorization` e `AuthorizationManagementService`

1. **`src/modules/authorization/**` permanece 100% módulo-folha (`ADR-0006`, `eslint.config.js`):** nenhuma regra de `eslint-plugin-boundaries` é relaxada; `authorization` continua proibido de importar qualquer outro módulo em `src/modules/*`.
2. **`AuthorizationManagementService`** reside em `src/modules/authorization/application/use-cases/authorization-management-service.ts`, coeso junto a `canGrantorDelegatePermission`, `deriveGrantStatus` e `evaluateAuthorization`, recebendo duas **portas mínimas locais** declaradas em `src/modules/authorization/application/ports/`:
   - **`AuthorizationContextLookupPort`**: resolve associação organizacional (`getOrganizationMembership`), resumo de escopos administrados/participados do ator (`getActorScopeSummary`), verificação de vínculo ativo (`isActiveOrganizationMember`) e existência de escopo dentro da organização (`scopeExistsInOrganization`).
   - **`AuthorizationAuditWriterPort`**: grava entradas de auditoria de autorização (`appendAuthorizationAuditEvent`) dentro da mesma transação `TransactionPort.run([PERMISSION_GRANTS | EXPLICIT_DENY_RULES, AUDIT_EVENTS], ...)`.
3. O wiring fino que adapta essas portas aos repositórios de `organizations`, `teams`, `projects` e `audit` ocorre exclusivamente em `src/app/composition/container.ts`.
4. **`PermissionGrantRepositoryPort`** recebe o método adicional **`revokeAllByScope(organizationId, scopeType, scopeId, revokedByUserId, revokedAt)`** (implementado em `DexiePermissionGrantRepository`) para revogação atômica de todas as concessões vinculadas a um escopo desativado/excluído.

### 2. Política de Aceitação Nominal de Convites (`InvitationService` — `PRD.md` §7.2, `SECURITY.md`)

1. **Correspondência obrigatória de e-mail normalizado:** como `Invitation.email` é nominal e obrigatório no domínio, `acceptInvitation` exige `normalizeEmail(actor.email) === normalizeEmail(invitation.email)`. Qualquer divergência é bloqueada com **`AuthorizationError`**, impedindo apropriação de códigos/links vazados ou compartilhados indevidamente.
2. **Pré-visualização segura (`previewInvitationByCode`):** retorna apenas projeção mínima (nome da organização, status derivado via `deriveInvitationStatus`, papel inicial, `expiresAt` e flag `emailMatchesActor: boolean`), sem expor lista de membros nem dados sensíveis.
3. **Proteção de estados de associação preexistentes:**
   - Se o ator já possuir `OrganizationMember` com status **`ACTIVE`** na organização do convite, `acceptInvitation` lança **`ConflictError`**.
   - Se o ator possuir `OrganizationMember` com status **`SUSPENDED`**, `acceptInvitation` lança **`AuthorizationError`** (impede contornar suspensão administrativa mediante novo convite).
4. **Atomicidade e uso único:** dentro de `TransactionPort.run([INVITATIONS, ORGANIZATION_MEMBERS, AUDIT_EVENTS], ...)`, valida `assertInvitationCanBeAccepted`, transita o convite para `ACCEPTED` (`acceptedAt`, `acceptedByUserId`), cria a associação `OrganizationMember` `ACTIVE` com `initialRole` padrão `'MEMBER'`, registra `AuditEvent` e publica evento pós-commit. Convite aceito, expirado ou revogado jamais pode ser reutilizado.

### 3. Integridade de Equipes e Revogação Atômica de Concessões (`TeamService` — `PRD.md` §7.3, `permission-matrix.md` §5.2 & §11)

1. **`deleteTeam` (`team.delete` — exclusivo `ADMIN`):**
   - Consulta `ProjectRepositoryPort.listByTeam(organizationId, teamId)` e verifica se existe qualquer projeto não-excluído (`!isSoftDeleted(project)`). Havendo projeto vinculado, **bloqueia com `ConflictError`**, exigindo desvinculação ou transferência prévia dos projetos.
   - Quando desimpedida, executa em transação atômica (`TEAMS`, `TEAM_MEMBERS`, `PERMISSION_GRANTS`, `AUDIT_EVENTS`): marca `deletedAt`, `deletedBy` e `deletionReason` em `Team`; invoca `PermissionGrantRepositoryPort.revokeAllByScope(organizationId, 'TEAM', teamId, actorUserId, now)` para revogar todas as concessões vinculadas ao escopo da equipe; grava `AuditEvent` (`team.deleted`) e publica evento pós-commit.
2. **`removeTeamMember` (`team.members.manage`):**
   - Na mesma transação (`TEAMS`, `TEAM_MEMBERS`, `PERMISSION_GRANTS`, `AUDIT_EVENTS`): marca `removedAt` no `TeamMember`, remove o usuário de `team.managerUserIds` caso ele figure como gestor da equipe, invoca `PermissionGrantRepositoryPort.revokeByScope(organizationId, targetUserId, 'TEAM', teamId, actorUserId, now)` (Cenário 7 de `permission-matrix.md` §11) e grava `AuditEvent`.
   - **Nunca** altera `OrganizationMember` nem apaga autoria histórica (`PRD.md` §7.3).
3. **`archiveTeam` / `restoreTeam` (`team.archive`):** arquivar impede novas associações (`assertTeamAcceptsMembers`) sem excluir projetos vinculados.

### 4. Sincronização Completa do `PermissionProvider`, Dependências e Persistência

1. **`listMyActiveAccessRules(actorUserId, organizationId)`** em `AuthorizationManagementService` retorna `{ grants, explicitDenies, managedTeamIds, memberTeamIds, managedProjectIds, participatedProjectIds }`, permitindo que o `PermissionProvider` construa um `AuthorizationActor` completo em uma única consulta assíncrona.
2. **`PermissionProvider`** sincroniza automaticamente ao alterar `(user?.id, activeOrganization?.id)`, expõe `refreshPermissions(): Promise<void>` e `isLoadingPermissions: boolean` para recarga imediata após mutações de grants/denies/equipes, e **limpa imediatamente** grants/denies/escopos ao trocar de organização ou deslogar (evitando *flash* cross-organization na UI). A autorização definitiva permanece obrigatória nos casos de uso.
3. **Zero novas dependências NPM e zero alteração de schema Dexie:** todas as 51 tabelas necessárias (`invitations`, `teams`, `teamMembers`, `permissionGrants`, `explicitDenyRules`, `auditEvents`, etc.) já existem no `PmsDatabase` Schema v2 (`ADR-0008`).
4. **Endurecimentos transversais herdados da Fase 04:** inclusão de `'salt'` em `SENSITIVE_SINGLE_TOKENS` (`src/shared/logging/redact.ts`) e verificação de vínculo `ACTIVE` via callback `isActiveOrganizationMember` injetado em `AuthService` e `UserService` antes de gravar `AuditEvent` com `activeOrganizationId` opcional (preservando o DAG acíclico `authorization` ← `users` ← `organizations` ← `authentication`).

## Alternativas Consideradas

1. **Relaxar a regra de módulo-folha de `src/modules/authorization/**` no `eslint.config.js`:** descartada porque `authorization` é importado por todos os módulos de domínio; permitir imports de saída criaria risco imediato de ciclos (`import-x/no-cycle`).
2. **Permitir que qualquer usuário autenticado aceite um convite com e-mail divergente:** descartada por enfraquecer o modelo de segurança local (`SECURITY.md`) diante de códigos ou links compartilhados indevidamente.
3. **Permitir `deleteTeam` com projetos ativos vinculados deixando `project.teamId` órfão:** descartada por violar integridade referencial e a exigência explícita de `permission-matrix.md` §5.2 (*"verificar vínculos e projetos antes da operação"*).
4. **Sincronizar apenas `grants` e `explicitDenies` no `PermissionProvider` sem `managedTeamIds`/`memberTeamIds`:** descartada porque causaria falso negativo na UI para `MANAGER` e `MEMBER` em ações de equipe (`team.view`, `team.update`).

## Consequências

- **Positivas:** módulo-folha `authorization` 100% preservado; convites nominais protegidos contra apropriação e contornos de suspensão; revogação imediata e atômica de concessões em remoções/exclusões de equipe; paridade fiel entre `PermissionProvider` e motor RBAC + ABAC; zero crescimento de bundle por novas dependências.
- **Trade-offs:** exige manter o wiring das duas portas locais de `authorization` em `src/app/composition/container.ts` e invocar `refreshPermissions()` nas telas que alteram equipes ou regras de acesso.
