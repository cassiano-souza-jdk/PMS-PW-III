# ADR-0007 --- Arquitetura de Persistência Local (Dexie v4 / IndexedDB) e Simulação HTTP (MSW v2)

- **Status:** Aceita
- **Data:** 2026-11-19
- **Fase:** 03 — Dexie, IndexedDB, Repositórios e MSW
- **Responsáveis:** Arquiteto de Software (redação) / PMS Orchestrator (aprovação)
- **Referências normativas:** `PRD.md` (§4–§25), `ARCHITECTURE.md`, `DATA-PERSISTENCE.md`, `API-SIMULATION.md`, `DOMAIN.md`, `MODULES.md`, `PERMISSIONS.md`, `SECURITY.md`, `CODING-STANDARDS.md`, `ADR-0001..0006`, `docs/contracts/event-envelope.md`, `docs/contracts/permission-matrix.md`.

## Contexto

Com a fundação técnica (`ADR-0004`, `ADR-0005`) e o modelo de domínio puro, motor RBAC + ABAC e as 44 interfaces `*RepositoryPort` + `TransactionPort` (49 recursos lógicos) + `AttachmentBlobStorePort` concluídos na Fase 02 (`ADR-0006`), a Fase 03 implementa a infraestrutura concreta de persistência local (`dexie@^4` sobre IndexedDB) e a camada de simulação HTTP (`msw@^2` + cliente HTTP tipado).

Para garantir fidelidade absoluta a `DATA-PERSISTENCE.md`, `API-SIMULATION.md`, `ADR-0002`, `ADR-0003` e às fronteiras mecânicas do `eslint.config.js` (`ADR-0005`, `ADR-0006`), cinco decisões arquiteturais precisam ser formalizadas:

1. Mapeamento físico das 49 stores lógicas (`TRANSACTION_RESOURCES`) e da store auxiliar de payloads de backup (`backupPayloads`) no schema v1 do Dexie v4, com índices compostos prefixados por `organizationId`.
2. Posicionamento de `src/shared/persistence/` e `src/shared/http/` em `shared-infra` versus `src/modules/<module>/infrastructure/`, preservando `module-public-api` livre de infraestrutura e impedindo acesso direto a Dexie/MSW na apresentação e no shell da aplicação.
3. Algoritmo determinístico de transações Dexie (`DexieTransactionAdapter`) integrado à publicação de eventos pós-commit (`PostCommitDomainEventBus`) sem provocar `PrematureCommitError`.
4. Invariantes físicas nos 44 repositórios Dexie: proteção contra colisão cross-tenant em `save`/`saveMany`, imutabilidade física (`Table.add`) em stores append-only, semântica padronizada para `SoftDeletable` e tradução não-destrutiva de `QuotaExceededError`.
5. Arquitetura do `HttpClient` tipado + MSW v2 (`X-Correlation-Id`, `SimulationScenarioController`, persistência confirmada antes da resposta HTTP, `public/mockServiceWorker.js`) e motor idempotente de seed determinística da organização demonstrativa (`DEMO_SEED_VERSION = '1.0.0'`).

## Decisão

### 1. Schema Versionado v1 do `PmsDatabase` (Dexie v4 — 50 Tabelas)

1. Instanciar `PmsDatabase` (subclasse tipada de `Dexie`, banco `'pms_local_db'`, `version(1)`) em `src/shared/persistence/` mapeando **50 tabelas físicas**:
   - As **49 stores canônicas** de `TRANSACTION_RESOURCES` (`src/shared/kernel/transactions.ts`);
   - A store física auxiliar **`backupPayloads`** (`'backupId, organizationId'`), dedicada a armazenar o payload JSON bruto de `BackupRepositoryPort.save(backup, payloadJson)` separado dos metadados leves de `backups`, evitando carregar megabytes de JSON em listagens de backups (`BackupRepositoryPort.listByOrganization`).
2. **Regras de indexação Dexie v4:**
   - Chaves primárias naturais onde aplicável: `organizationSettings` (`'organizationId'`), `attachmentBlobs` (`'attachmentId'`), `backupPayloads` (`'backupId'`) e `'id'` nas demais 47 stores.
   - Todas as tabelas organizacionais utilizam **índices compostos prefixados por `organizationId`** (ex.: `[organizationId+projectId]`, `[organizationId+taskId]`, `[organizationId+feedbackId]`, `[organizationId+userId]`, `[organizationId+deduplicationKey]`, `[organizationId+occurredAt]`), garantindo isolamento multi-tenant diretamente no cursor do IndexedDB.
   - **Proibido** indexar campos booleanos ou campos opcionais (`undefined`) como parte de chaves compostas no IndexedDB (chaves `undefined` ou `boolean` não são tipos de chave válidos na especificação IndexedDB); filtros sobre campos opcionais (`deletedAt`, `archivedAt`, `revokedAt`, `readAt`) são aplicados via `.filter(...)` sobre o cursor já particionado pelo índice composto de `organizationId`.
3. **Migração e inicialização não-destrutiva (`DATA-PERSISTENCE.md`):**
   - O gerenciador de schema mantém registro de versão e jamais apaga ou sobrescreve stores existentes na abertura do banco.

### 2. Topologia de Infraestrutura e Fronteiras ESLint (`shared-infra` vs `module-infrastructure`)

1. **Infraestrutura Transversal Compartilhada (`shared-infra`):**
   - `src/shared/persistence/**`: `PmsDatabase`, `DexieTransactionAdapter`, `PostCommitDomainEventBus`, `DexieAttachmentBlobStore`, tradutor de `QuotaExceededError` e motor de bootstrap/seed idempotente.
   - `src/shared/http/**`: `HttpClient` tipado, envelope HTTP canônico, mapeador `AppErrorCode <-> HTTP status` e `SimulationScenarioController`.
   - Em `eslint.config.js`, o elemento `shared-infra` passa a englobar `['src/shared/config/**', 'src/shared/logging/**', 'src/shared/persistence/**', 'src/shared/http/**']`.
2. **Infraestrutura Modular (`module-infrastructure`):**
   - `src/modules/<module>/infrastructure/repositories/**`: implementações Dexie das 44 interfaces `*RepositoryPort`.
   - `src/modules/<module>/infrastructure/msw/**` (ou handlers modulares): handlers MSW v2 do módulo.
   - Pelas políticas de `eslint-plugin-boundaries`, `module-infrastructure` pode importar apenas `module-domain`, `module-application` e `module-infrastructure` do **mesmo módulo** + `shared-kernel` + `shared-infra`.
   - `module-public-api` (`src/modules/*/index.ts`) permanece **estritamente proibido** de reexportar `module-infrastructure`.
   - Apenas `src/app/composition/**` (`app-composition`) e arquivos de teste (`*.test.ts(x)`) podem importar `src/modules/*/infrastructure/**`.
3. **Endurecimento de `no-restricted-imports` (Camada 2 do ESLint):**
   - Estender o bloqueio direto de `dexie`, `dexie/*`, `msw` e `msw/*` para incluir também `src/app/providers/**/*.{ts,tsx}` e `src/app/App.tsx` (além de `src/modules/*/presentation/**`, `src/app/layout/**`, `src/app/router/**` e `src/shared/ui/**`).

### 3. Transações Declarativas (`DexieTransactionAdapter`) e Eventos Pós-Commit (`PostCommitDomainEventBus`)

1. **Expansão transparente de recursos transacionais:**
   - Ao executar `TransactionPort.run(resources, work)`, o `DexieTransactionAdapter` converte cada `TransactionResource` na tabela correspondente de `PmsDatabase`. Quando `TRANSACTION_RESOURCES.BACKUPS` (`'backups'`) estiver incluído em `resources`, o adapter inclui automaticamente a tabela `'backupPayloads'` no escopo `db.transaction('rw', tables, ...)`.
2. **Enfileiramento vinculado à transação raiz e despacho estritamente pós-commit:**
   - `PostCommitDomainEventBus` (implementando `DomainEventPublisherPort`) trabalha em conjunto com `DexieTransactionAdapter`.
   - Quando `publish(event)` é invocado dentro de uma transação ativa do `DexieTransactionAdapter` (inclusive em chamadas `run()` aninhadas/reentrantes que reutilizam a transação pai compatível), o evento é apenas adicionado de forma síncrona em memória ao buffer da transação raiz, sem disparar listeners externos nem timers/IO não-Dexie dentro da transação.
   - Somente **após** a Promise de `db.transaction(...)` da transação raiz resolver com sucesso (confirmando o commit físico no IndexedDB), o buffer de eventos é drenado e entregue sequencialmente aos subscribers registrados (`subscribe(handler)`).
   - Se a transação falhar ou sofrer rollback/abort, o buffer de eventos acumulado é integralmente descartado, cumprindo `PRD.md` §16/§24 e `docs/contracts/event-envelope.md` (*"Eventos são emitidos após persistência confirmada"*).
   - Quando `publish(event)` é chamado fora de qualquer transação ativa, o evento é despachado imediatamente após validação do envelope.
3. **Prevenção de `PrematureCommitError`:**
   - Dentro do callback `work` de `TransactionPort.run`, nenhuma API assíncrona externa ao Dexie (`fetch`, `setTimeout`, `crypto.subtle`) pode ser aguardada antes da última operação Dexie.

### 4. Invariantes Físicas dos 44 Repositórios Dexie e `DexieAttachmentBlobStore`

1. **Guarda anti-colisão cross-tenant em `save` / `saveMany`:**
   - Antes de executar `table.put(entity)` em qualquer repositório organizacional (`OrganizationScoped`), o repositório verifica se já existe registro com a mesma chave primária no banco. Caso exista e `existing.organizationId !== entity.organizationId`, `assertSameOrganization` lança `AuthorizationError` (`APP_ERROR_CODES.AUTHORIZATION_ERROR`), impedindo sobrescrita cross-organization por colisão ou falsificação de ID.
   - Em todas as leituras por ID (`findById(organizationId, id)`), se o registro existir mas pertencer a outra `organizationId`, o repositório retorna `null` sem vazar dados de outra organização.
2. **Imutabilidade física (`Table.add` insert-only) em stores append-only:**
   - Stores imutáveis/append-only (`auditEvents`, `maintenanceEvents`, `feedbackMessages`, `feedbackInternalNotes`, `feedbackContestAnalyses`, `feedbackContestDecisions`, `taskDeadlineHistory`, `feedbackCategoryVersions`, `feedbackContestReasonVersions`, `feedbackSlaSnapshots`) utilizam **`table.add(...)`** em vez de `put(...)`. Qualquer tentativa de sobrescrever um ID já existente captura `ConstraintError` do Dexie e lança `ConflictError` (`APP_ERROR_CODES.CONFLICT`).
3. **Semântica consistente de `SoftDeletable`:**
   - `findById(organizationId, id)` retorna a entidade da mesma organização mesmo quando `deletedAt !== undefined` (permitindo verificação de estado `DENIED_RESOURCE_DELETED`, visualização na Lixeira e restauração).
   - Métodos de listagem (`listBy*`) omitem registros com `isSoftDeleted(entity) === true` por padrão, incluindo-os somente quando `options?.includeDeleted === true`.
4. **Armazenamento binário de anexos (`DexieAttachmentBlobStore`) e tratamento seguro de `QuotaExceededError`:**
   - `DexieAttachmentBlobStore` valida `validateAttachmentQuota` (`15 MB` por arquivo) e persiste `AttachmentBlobPayload` na tabela `attachmentBlobs` verificando isolamento por `organizationId` em `getBlob`, `putBlob` e `deleteBlob`.
   - Qualquer erro `QuotaExceededError` do IndexedDB/Dexie (em `putBlob`, backups ou repositórios) é capturado pelo tradutor transversal `translateDexieError` e convertido em `InfrastructureError` (`APP_ERROR_CODES.INFRASTRUCTURE_ERROR`) com diagnóstico estruturado (`details: { reason: 'STORAGE_QUOTA_EXCEEDED', operation }`), **jamais** apagando dados de negócio automaticamente (`DATA-PERSISTENCE.md`).

### 5. Arquitetura do Cliente HTTP Tipado, MSW v2 e Seed Determinística Demo

1. **Cliente HTTP Tipado (`src/shared/http/`):**
   - Opera sobre `fetch` com prefixo base `/api/v1`, injetando e propagando `X-Correlation-Id` (UUID v4), `X-Organization-Id` e `X-Actor-User-Id`.
   - Padroniza envelopes de sucesso (`{ data: T, meta: { correlationId, timestamp } }`) e erro (`{ error: { code: AppErrorCode, message: string, correlationId: string, details?: Record<string, unknown> } }`).
   - Mapeamento canônico `AppErrorCode <-> HTTP status`:
     - `AUTHENTICATION_ERROR` <-> `401`
     - `AUTHORIZATION_ERROR` <-> `403`
     - `NOT_FOUND` <-> `404`
     - `CONFLICT` <-> `409`
     - `VALIDATION_ERROR` <-> `422`
     - `INFRASTRUCTURE_ERROR` / `UNEXPECTED_ERROR` <-> `500`
   - `SimulationScenarioController`: permite configurar latência (`latencyMs`) e falhas determinísticas por método/rota (`forceStatus`, `forceErrorCode`, `failNextCount`) para testes e simulação realista de rede (`API-SIMULATION.md`).
2. **Handlers MSW v2 e Suporte Dual (Node + Browser):**
   - Handlers MSW delegam leitura/escrita aos repositórios Dexie e ao motor RBAC + ABAC (`evaluateAuthorization`), **aguardando a confirmação da persistência (`await`) antes de emitir resposta HTTP de sucesso** (`API-SIMULATION.md`).
   - Os contratos dos endpoints são documentados em `PMS_Documentacao/docs/contracts/api-endpoints.md`.
   - `public/mockServiceWorker.js` é versionado para suporte no navegador (`setupWorker` com `onUnhandledRequest: 'bypass'` para nunca bloquear assets/rotas SPA), mantendo paridade com `setupServer` (`msw/node`) usado na suíte de integração Vitest.
3. **Seed Determinística Idempotente da Organização Demonstrativa (`DEMO_SEED_VERSION = '1.0.0'`):**
   - O serviço `ensureDemoOrganizationSeeded` verifica dentro de transação Dexie se a organização demonstrativa canônica já existe. Caso exista, retorna imediatamente (`seeded: false`) sem alterar nem sobrescrever dados existentes (`DATA-PERSISTENCE.md`).
   - Quando ausente, popula atomicamente a organização demonstrativa isolada, `OrganizationSettings` padrão, os 3 perfis demonstrativos (`ADMIN`, `MANAGER`, `MEMBER`), equipe, projeto, quadro Kanban com 4 colunas, tarefas iniciais, catálogos versionados iniciais de Feedback (`INITIAL_FEEDBACK_CATEGORIES`, `INITIAL_CONTEST_REASONS`) e o evento inicial em `MaintenanceEvent` (`action: 'SEED'`, `status: 'SUCCESS'`).

## Alternativas Consideradas

1. **Colocar `PmsDatabase` dentro de um módulo específico em `src/modules/`:** descartada porque uma transação Dexie multi-entidade (`TransactionPort.run`) precisa acessar tabelas de múltiplos módulos simultaneamente; colocá-lo em um módulo de negócio forçaria acoplamento transversal entre `infrastructure` de módulos distintos.
2. **Armazenar o JSON completo de backup dentro da própria tabela `backups`:** descartada porque `BackupRepositoryPort.listByOrganization` precisaria desserializar todos os snapshots completos em memória apenas para exibir o histórico de backups.
3. **Emitir eventos imediatamente dentro do método `save` do repositório antes do commit da transação:** descartada por violar `PRD.md` §16/§24 e `docs/contracts/event-envelope.md` caso a transação sofra rollback posterior.
4. **Indexar campos booleanos ou `deletedAt` opcional em índices compostos do IndexedDB:** descartada porque a especificação IndexedDB rejeita `boolean` e `undefined` como valores de chave (`DataError`), o que excluiria registros ativos (`deletedAt: undefined`) do índice composto.

## Consequências

- **Positivas:** isolamento multi-organização garantido tanto na consulta indexada quanto na escrita (`assertSameOrganization`); zero risco de `PrematureCommitError` ou eventos fantasma em rollbacks; imutabilidade física de trilhas de auditoria e histórico; simulação HTTP realista e testável em Node e Browser sem contaminar o domínio.
- **Trade-offs:** filtros sobre campos opcionais (`deletedAt`, `archivedAt`) são avaliados em memória pelo cursor do Dexie logo após o particionamento primário pelo índice composto `[organizationId+...]`, mantendo compatibilidade total com a especificação IndexedDB e alta seletividade por organização/escopo.
