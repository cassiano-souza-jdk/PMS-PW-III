# ADR-0008 --- Arquitetura de Autenticação Simulada, Sessões por Dispositivo e Gestão Multi-Organização

- **Status:** Aceita
- **Data:** 2026-11-20
- **Fase:** 04 — Autenticação, Usuários e Organizações
- **Responsáveis:** Arquiteto de Software (redação) / PMS Orchestrator (aprovação)
- **Referências normativas:** `PRD.md` (§4, §5, §6, §7.1, §18, §22–§24), `ARCHITECTURE.md`, `DOMAIN.md`, `PERMISSIONS.md`, `SECURITY.md`, `DATA-PERSISTENCE.md`, `ACCESSIBILITY.md`, `CODING-STANDARDS.md`, `ADR-0001..0007`, `docs/contracts/permission-matrix.md` (§5.1), `docs/contracts/api-endpoints.md`, `docs/contracts/event-envelope.md`.

## Contexto

Com a fundação técnica (`ADR-0004`, `ADR-0005`), o modelo de domínio puro + motor RBAC/ABAC (`ADR-0006`) e a camada de persistência Dexie v4 + MSW v2 (`ADR-0007`) concluídos nas Fases 01–03, a Fase 04 implementa os fluxos completos de **Autenticação simulada, Sessões por dispositivo, Perfil de Usuário e Gestão Multi-Organização** (incluindo entrada rápida no Ambiente Demonstrativo isolado com perfis `ADMIN`, `MANAGER` e `MEMBER` e banner permanente).

Para preservar integralmente a pureza do domínio, as fronteiras mecânicas do `eslint.config.js`, os requisitos de segurança local de `PRD.md` §6 / `SECURITY.md`, a integridade transacional de `DATA-PERSISTENCE.md` e a conformidade WCAG 2.2 AA, cinco decisões arquiteturais precisam ser formalizadas:

1. Seleção exata das dependências de formulários da Fase 04 compatíveis com `zod@^3.24.4`, `react@^18.3.1`, Node 24 e `pnpm@9`.
2. Modelagem de credenciais simuladas de e-mail/senha sem contaminar a entidade `User`, com a primeira migração versionada não-destrutiva do `PmsDatabase` (Schema `v1 -> v2`) e sem risco de `PrematureCommitError`.
3. Estratégia de persistência e restauração de sessão (`persistent: true` vs `persistent: false`) com access token estritamente em memória e zero segredos em `localStorage`.
4. Topologia acíclica entre módulos (`application/`), fachada `container.services` em `src/app/composition/`, separação de projeções em `organizations` (`listMyOrganizations` vs `getOrganizationDetails`) e política de auditoria para operações globais versus organizacionais.
5. Ajustes preventivos de qualidade e acessibilidade herdados das Fases 01–02 (contraste não-textual WCAG 2.2 SC 1.4.11 em `.dark --input` e cobertura de `e2e/` no `typecheck`).

## Decisão

### 1. Dependências de Formulários da Fase 04 (`ADR-0004` §3)

1. Instalar exclusivamente:
   - `react-hook-form@^7.55.0`
   - `@hookform/resolvers@^3.10.0`
2. **Restrição de compatibilidade:** `@hookform/resolvers` é fixado na linha `3.x` (`^3.10.0`), cujo `peerDependencies` declara apenas `react-hook-form: ^7.0.0`, garantindo resolução limpa sem peer warnings nem incompatibilidades de tipagem com `zod@^3.24.4` (evitando `@hookform/resolvers@^5.4.1`, que exige `zod@^3.25.0 || ^4.0.0`).
3. Permanecem proibidas na Fase 04 dependências de fases posteriores (`@dnd-kit`, `recharts`, `vite-plugin-pwa`).

### 2. Credenciais Simuladas e Migração Versionada Dexie `v1 -> v2` (51 Tabelas)

1. **Pureza da entidade `User`:** a entidade `User` (`src/modules/users/domain/user.ts`) permanece 100% livre de senha, hash ou verificador, impedindo vazamento acidental em DTOs de perfil, listagens de membros, auditoria (`before`/`after`) ou exportações JSON.
2. **Schema Dexie v2 (51 tabelas, migração não-destrutiva `v1 -> v2`):**
   - `PmsDatabase` mantém `this.version(1).stores({ ...PMS_SCHEMA_V1_STORES })` inalterado e declara `this.version(2).stores({ ...PMS_SCHEMA_V2_STORES })` acrescentando exclusivamente a store **`localCredentials`** (`'userId, &email'`), onde `userId` é chave primária natural (1:1 com `User`) e `&email` impõe unicidade sobre o e-mail normalizado.
   - Registrar `LOCAL_CREDENTIALS: 'localCredentials'` em `TRANSACTION_RESOURCES` (`src/shared/kernel/transactions.ts`).
   - A migração `v1 -> v2` é estritamente aditiva e não-destrutiva (`DATA-PERSISTENCE.md`), preservando integralmente todos os registros das 50 tabelas da versão 1 e sendo coberta por testes automatizados de upgrade com `fake-indexeddb`.
3. **Contratos e separação de camadas em `src/modules/authentication/`:**
   - `domain/local-credential.ts`: contrato puro `LocalCredential` (`userId`, `email`, `passwordVerifier`, `salt`, `algorithm: 'SHA-256-SIMULATED'`, `updatedAt`), livre de WebCrypto/Dexie/Zod.
   - `application/ports/local-credential-repository.port.ts`: interface `LocalCredentialRepositoryPort`.
   - `application/ports/password-verifier.port.ts`: interface `PasswordVerifierPort` (`hashPassword`, `verifyPassword`).
   - `infrastructure/`: `DexieLocalCredentialRepository` e `WebCryptoSimulatedPasswordVerifier` (SHA-256 + salt aleatório por usuário, com fallback determinístico puro quando `crypto.subtle` não estiver disponível em contexto não-seguro). Senhas jamais são armazenadas em texto puro nem registradas em logs ou auditoria.
   - **Nota de segurança (`SECURITY.md`):** o verificador local simula o fluxo de autenticação no cliente e **não** substitui hashing de servidor (`Argon2id`/`bcrypt`) em produção real.
4. **Prevenção de `PrematureCommitError` (`ADR-0007` §3.3):**
   - Toda invocação assíncrona a `PasswordVerifierPort.hashPassword(...)` ou `verifyPassword(...)` **DEVE ser executada fora/antes de `TransactionPort.run(...)`**. Jamais aguardar `crypto.subtle.digest` dentro de uma transação Dexie ativa.
5. **Seed determinística e upgrade idempotente (`demo-seed.ts`):**
   - `ensureDemoOrganizationSeeded` inclui `TRANSACTION_RESOURCES.LOCAL_CREDENTIALS`, calcula os verificadores fictícios dos 3 perfis demo (`admin.demo@pms.local`, `gestor.demo@pms.local`, `membro.demo@pms.local`) **antes** de abrir `TransactionPort.run(...)` e os persiste atomicamente.
   - Para bancos já semeados na versão 1 que sofrerem upgrade para a versão 2, um passo idempotente (`ensureDemoCredentialsSeeded`) cria apenas as credenciais demo faltantes sem sobrescrever nenhum registro preexistente.

### 3. Sessão Simulada sem `localStorage` (`PRD.md` §6, `SECURITY.md`)

1. **Access token simulado estritamente em memória:** emitido efemeramente em memória a cada login, cadastro, entrada demo ou restauração de sessão; **nunca** gravado em `localStorage`, `sessionStorage`, IndexedDB ou logs.
2. **Sessão persistente (`persistent: true`) controlada no IndexedDB (`userSessions`):**
   - `UserSessionRepositoryPort` expõe `findLatestActivePersistent(now: IsoDateTime): Promise<UserSession | null>`, respeitando `ADR-0007` §1.2 (sem indexar campos booleanos ou opcionais no IndexedDB; filtrando `session.persistent && isSessionActiveAt(session, now)` e ordenando por `lastActivityAt`/`createdAt` decrescente).
   - No reload da aplicação, `restoreActiveSession` valida a sessão (`assertSessionValid`), verifica que o usuário não foi soft-deleted, atualiza `lastActivityAt` e emite um novo `accessToken` simulado em memória.
   - Logout ou revogação (`revokeSession` / `revokeAllSessions`) grava `revokedAt` no IndexedDB, bloqueando qualquer restauração futura daquela sessão.
3. **Sessão temporária (`persistent: false`) via `EphemeralSessionPointerPort`:**
   - Armazena exclusivamente o **`sessionId` opaco (UUID não-secreto)** em `window.sessionStorage`, encapsulado pela porta `EphemeralSessionPointerPort` (`getSessionId`, `setSessionId`, `clear`) injetada via `container.ts` (com adapter de navegador em `infrastructure/` e adapter em memória para testes Node).
   - Ao fechar a aba/janela, o ponteiro é descartado pelo navegador. No reload da mesma aba (F5), `restoreActiveSession` consulta primeiro `EphemeralSessionPointerPort` e, ausente ou inválida, recorre a `findLatestActivePersistent(now)`.
   - **`localStorage` não é utilizado em nenhuma etapa de autenticação ou sessão.**

### 4. Organização de Casos de Uso, DAG Acíclico, Fachada `container.services` e Auditoria

1. **DAG acíclico obrigatório entre módulos (`import-x/no-cycle`, `ADR-0006`):**
   - `authorization` (módulo-folha — não importa outros módulos)
   - `users` → pode importar apenas `authorization`, `audit`
   - `organizations` → pode importar apenas `authorization`, `users`, `settings`, `audit`
   - `authentication` → pode importar `users`, `organizations`, `audit`, `demo`
2. **Injeção de `seedDemoOrganization` em `enterDemoProfile`:** como `module-application` não pode importar `src/app/composition/**` (`eslint.config.js`), o caso de uso `enterDemoProfile` recebe `seedDemoOrganization` por injeção de dependência (callback/porta) a partir de `src/app/composition/container.ts`.
3. **Fachada `container.services` e isolamento de `providers/` / `presentation/`:**
   - `AppCompositionContainer` expõe `services: { auth, users, organizations }` instanciados com repositórios, `transactionPort`, `eventBus`, `passwordVerifier`, `ephemeralSessionPointer` e `seedDemoOrganization`.
   - `AuthProvider`, `OrganizationProvider`, `PermissionProvider` (`src/app/providers/`) e as páginas de `presentation/` consomem exclusivamente `useComposition().services` (e funções puras de `@/modules/authorization` no `PermissionProvider`), jamais acessando Dexie, MSW, `infrastructure/` ou `container.db` diretamente.
4. **Separação de projeções em `organizations` (`permission-matrix.md` §5.1):**
   - `listMyOrganizations`: retorna apenas projeção mínima (`id`, `name`, `slug`, `isDemo`, `role`, `status`) das organizações onde o ator autenticado possui `OrganizationMember` `ACTIVE` (permitido a `ADMIN`, `MANAGER` e `MEMBER` para o seletor de organizações — `PRD.md` §5).
   - `getOrganizationDetails`: protegido por `assertAuthorized(..., PERMISSION_CODES.ORGANIZATION_VIEW)` (restrito a `ADMIN` ou grant explícito).
   - `leaveOrganization`: ação do próprio ator autenticado; protegida por `assertCanChangeOrRemoveAdmin` para impedir saída do último `ADMIN` ativo sem transferência e **nunca** encerra a sessão global (`PRD.md` §5).
   - `updateOrganization` (`ORGANIZATION_UPDATE`), `listOrganizationMembers` (`ORGANIZATION_MEMBERS_VIEW`), `changeMemberRole` (`ORGANIZATION_ROLES_MANAGE` + `assertCanChangeOrRemoveAdmin`) e `suspendOrReactivateMember` (`ORGANIZATION_MEMBERS_MANAGE` + `assertCanChangeOrRemoveAdmin` ao suspender) validam autorização no caso de uso.
5. **Auditoria em operações globais versus organizacionais:**
   - Operações organizacionais gravam `AuditEvent` (`OrganizationScoped`) dentro da mesma transação Dexie e publicam evento pós-commit.
   - Operações globais de conta/sessão (`registerUser`, `loginWithPassword`, `logoutCurrentSession`, `revokeSession`, `revokeAllSessions`, `updateMyProfile`) podem ocorrer com zero organizações associadas; emitem eventos/logs estruturados sanitizados (sem senha nem token) e gravam `AuditEvent` somente quando houver `activeOrganizationId` válida, sem jamais falhar por ausência de organização.

### 5. Ajustes Preventivos de Acessibilidade e Typecheck E2E

1. **WCAG 2.2 SC 1.4.11 (Non-text Contrast):** ajustar `.dark --input` em `src/app/styles/globals.css` de `217 28% 36%` para `217 28% 45%`, garantindo contraste de borda de campos `>= 3.4:1` sobre `--background` (`222 47% 7%`) e `--card` (`222 44% 11%`).
2. **Cobertura de `e2e/` no `typecheck`:** criar `tsconfig.e2e.json` cobrindo `e2e/**/*.ts` com as mesmas flags estritas (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noEmit`) e referenciá-lo em `tsconfig.json` para que `pnpm.cmd typecheck` (`tsc -b --noEmit`) valide automaticamente todos os testes E2E Playwright.

## Alternativas Consideradas

1. **Adicionar `passwordHash` diretamente à entidade `User`:** descartada por poluir o domínio de usuários e aumentar o risco de exposição acidental em consultas de perfil, listagens de membros, auditoria e exportações JSON.
2. **Armazenar sessão ou token simulado em `localStorage`:** descartada por violar explicitamente `PRD.md` §6 (*"sem token secreto em LocalStorage"*).
3. **Instalar `@hookform/resolvers@^5`:** descartada por exigir `zod@^3.25.0 || ^4.0.0` (conflitante com `zod@^3.24.4` em `package.json`) e adicionar mais de 25 peerDependencies opcionais.
4. **Chamar `ensureDemoOrganizationSeeded` diretamente de `authentication/application/`:** descartada por violar as regras estruturais de `eslint-plugin-boundaries` (`module-application` não pode depender de `app-composition`).

## Consequências

- **Positivas:** `User` permanece limpo; primeira migração Dexie `v1 -> v2` exercitada e testável de forma não-destrutiva; zero risco de `PrematureCommitError` ou ciclos entre módulos; zero segredos em `localStorage`; conformidade WCAG 2.2 AA em inputs de tema escuro e tipagem estrita garantida para a suíte Playwright E2E.
- **Trade-offs:** exige manter a porta `PasswordVerifierPort` executada antes da abertura da transação Dexie em todos os casos de uso de autenticação e exige atenção à idempotência de `ensureDemoCredentialsSeeded` em upgrades `v1 -> v2`.
