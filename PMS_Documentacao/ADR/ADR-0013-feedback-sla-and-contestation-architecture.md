# ADR-0013 --- Arquitetura de Feedbacks, SLA, Contestações e Reabertura Excepcional

- **Status:** Aceita
- **Data:** 2026-11-25
- **Fase:** 09 — Feedbacks, SLA, Contestações e Reabertura Excepcional
- **Responsáveis:** Arquiteto de Software (redação) / PMS Orchestrator (aprovação)
- **Referências normativas:** `PRD.md` (§15, §22, §23, §24), `PERMISSIONS.md`, `SECURITY.md`, `ARCHITECTURE.md`, `DOMAIN.md`, `MODULES.md`, `DATA-PERSISTENCE.md`, `API-SIMULATION.md`, `ACCESSIBILITY.md`, `CODING-STANDARDS.md`, `ADR-0001..0012`, `docs/modules/feedback-contestation.md`, `docs/contracts/permission-matrix.md` (§5.7, §6–§12), `docs/contracts/api-endpoints.md` (§4, §6–§10), `docs/contracts/event-envelope.md`.

## Contexto

Com a conclusão do núcleo operacional de trabalho e inteligência operacional nas Fases 06–08 (`ADR-0010`, `ADR-0011`, `ADR-0012`), a Fase 09 (`F09-T00`..`F09-T05`) operacionaliza integralmente o módulo **`feedback`**: cadastro de feedbacks por módulo e categoria versionada, comunicação bidirecional pública e notas internas segregadas, anexos binários com quarentena MIME e checksum SHA-256, cálculo e avaliação de SLA (primeira resposta e resolução com calendário contínuo ou comercial, pausas em `WAITING_INFO`, marcos preventivos `80%`, vencimentos e escalonamento sem troca automática de responsável), janela de manifestação/contestação, delegação e parecer estruturado de contestação, decisão administrativa exclusiva de `ADMIN`, encerramento por confirmação do autor ou expiração preservando estado `RESOLVED`, reabertura excepcional e exportação segmentada.

Esta arquitetura deve respeitar três invariantes estruturais do projeto:

1. **Preservação integral do Schema Dexie `v2` (`51` tabelas)** em `src/shared/persistence/pms-database.ts` (zero migração `v2 -> v3`, mantendo intactos todos os índices das 14 stores `feedback*` e `attachmentBlobs`) e **zero novas dependências NPM** em `package.json` e `pnpm-lock.yaml`.
2. **Preservação integral de `src/modules/authorization/**`** como módulo-folha (`ADR-0006`), aplicando reforços de regra na camada de aplicação onde necessário sem quebrar o motor ABAC canônico.
3. **Blindagem mecânica do DAG acíclico** no `eslint.config.js` e em `src/test/architecture-boundaries.test.ts`, isolando `feedback` de módulos de trabalho/analytics/usuários e incorporando o backlog `[BAIXO]` herdado da Fase 08 (`projects` proibido de importar `bottlenecks`).

---

## Decisão

### 1. Decisões Normativas Aprovadas (`DN-01`..`DN-08` — Plano `F09-T00`)

1. **`DN-01` — Governança de Calendário SLA, Feriados e Políticas por Prioridade em `OrganizationSettings`:**
   - A edição do calendário organizacional (`CONTINUOUS` / `BUSINESS_HOURS`, dias úteis UTC, horário inicial/final, intervalos e lista de feriados `holidayDates`), das políticas por prioridade (`slaPoliciesByPriority`: `firstResponseTargetMs` e `resolutionTargetMs` para `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) e das janelas independentes `feedbackManifestationWindowMs` e `feedbackContestWindowMs` ocorre diretamente em `OrganizationSettings` (`settings` store).
   - O acesso à mutação dessa configuração é protegido estritamente por **`PERMISSION_CODES.FEEDBACK_SLA_MANAGE`** (**exclusivo `ADMIN`** via `adminExclusiveRule`), gerando `AuditEvent` (`category: AUDIT_CATEGORIES.ORGANIZATION`) e evento pós-commit.
   - A avaliação de SLA utiliza o limiar preventivo padrão de **`80%` (`0.8`)** do alvo (`evaluateSlaStatus(elapsedMs, targetMs, 0.8)`).

2. **`DN-02` — Imutabilidade pós-envio (`append-only`) e Soft-Delete para Motivos não utilizados:**
   - Feedbacks enviados, mensagens públicas (`FeedbackMessage`), notas internas (`FeedbackInternalNote`), anexos (`FeedbackAttachment` / `AttachmentBlobPayload`), versões de categoria/motivo, pareceres (`FeedbackContestAnalysis`), decisões (`FeedbackContestDecision`) e snapshots de SLA (`FeedbackSlaSnapshot`) são **estritamente imutáveis após criação** (`append-only` / `save` protegido contra alteração retroativa).
   - `FeedbackCategory` e `FeedbackContestReason` implementam `SoftDeletable` (`deletedAt?`, `deletedBy?`, `deletionReason?`). Motivos de contestação (`FeedbackContestReason`) e categorias (`FeedbackCategory`) que **nunca foram utilizados** (`hasBeenUsed === false`) suportam exclusão lógica (*soft-delete*); após primeiro uso (`hasBeenUsed === true`), podem apenas ser desativados/reativados e ordenados, preservando versões históricas (`assertCategoryDeletionAllowed` / equivalente para motivos).

3. **`DN-03` — Restrição de Prioridade/Categoria e Imutabilidade do `FeedbackSlaSnapshot` em andamento:**
   - Alteração de prioridade ou categoria de um feedback existente é restrita a **`ADMIN`** por padrão (*Default Deny*), salvo concessão explícita (`PermissionGrant` ativo para **`PERMISSION_CODES.FEEDBACK_STATUS_MANAGE`** no escopo adequado).
   - Qualquer alteração de prioridade ou categoria **mantém estritamente imutável o `FeedbackSlaSnapshot` do ciclo em andamento** (`prioritySnapshot` e metas capturadas na abertura do ciclo continuam regendo `FIRST_RESPONSE` e `RESOLUTION` até o fim do ciclo atual; novas metas aplicam-se apenas a eventuais ciclos futuros `CONTESTATION_REOPEN` ou `EXCEPTIONAL_REOPEN`).

4. **`DN-04` — Autoridade Exclusiva do Autor, Segregação de Notas Internas e Bloqueio de Auto-Atribuição de Autor:**
   - Abertura de contestação (`FeedbackContest`), confirmação de resolução (`confirmFeedbackResolution`) e solicitação de reabertura excepcional (`FeedbackReopenRequest`) são restritas ao **autor do feedback** (admitindo-se `ADMIN` na reabertura excepcional conforme regra `FEEDBACK_REOPEN_DECIDE` / `FEEDBACK_REOPEN_REQUEST` do motor de políticas).
   - **Bloqueio explícito em `assignFeedback`:** é estritamente proibido atribuir um feedback ao próprio autor quando o usuário alvo não possuir papel `ADMIN` (`targetRole !== 'ADMIN' && targetUserId === feedback.authorUserId` retorna `ConflictError` / `AuthorizationError` conforme regra de conflito de segregação de funções), impedindo que `MANAGER` autor adquira acesso privilegiado ao próprio atendimento.
   - **Reforço em notas internas:** além da regra `feedbackInternalNoteRule` em `policy-engine.ts` (que bloqueia `MEMBER` e exige atribuição ou grant para `MANAGER`), a camada de aplicação nega `FEEDBACK_INTERNAL_NOTE_CREATE` e `FEEDBACK_INTERNAL_NOTE_VIEW` sempre que **`isFeedbackAuthor && role !== 'ADMIN'`** (mesmo se o ator possuir papel `MANAGER` ou um grant genérico no recurso), garantindo que nenhum autor não-`ADMIN` jamais leia ou crie notas internas no próprio feedback.
   - **Segregação estrita de anexos internos:** todo `FeedbackAttachment` vinculado a `internalNoteId` herda obrigatoriamente a autorização de **`FEEDBACK_INTERNAL_NOTE_VIEW`** no download e na listagem, e seu upload exige **`FEEDBACK_INTERNAL_NOTE_CREATE`** (jamais visível ou baixável pelo autor não-`ADMIN`).

5. **`DN-05` — Leituras Puras (`GET`) vs Avaliação Persistente Sob Demanda (`POST .../evaluate-sla`):**
   - Operações de leitura (`GET /feedbacks`, `GET /feedbacks/:feedbackId`, etc.) calculam o status atual de SLA ao vivo (`calculateSlaElapsedMs` + `evaluateSlaStatus`) em memória, **sem jamais mutar o IndexedDB/Dexie**.
   - A persistência de marcos SLA e encerramentos automáticos ocorre exclusivamente via caso de uso explícito **`evaluateFeedbackSlas`** (`POST /api/v1/organizations/:organizationId/feedbacks/evaluate-sla`):
     - Persiste marcos deduplicados no `FeedbackCycle` (`firstResponseWarningAt`, `firstResponseBreachedAt`, `resolutionWarningAt`, `resolutionBreachedAt`, `escalatedAt`) apenas na primeira transição de cada marco, sem nunca sobrescrever timestamp já registrado e **sem trocar automaticamente o `assigneeId`** no escalonamento (`escalatedAt` sinaliza para `ADMIN` preservando o responsável atual).
     - Executa auto-encerramento por expiração (`canAutoCloseResolvedFeedback` / `autoCloseResolvedFeedback`) quando ambas as janelas (`manifestationDeadlineAt` e `contestDeadlineAt`) expiraram sem contestação pendente, gravando `closedAt` e `closureReason: 'EXPIRED_WITHOUT_CONTEST'`, **`authorConfirmedResolution: false`** e **preservando `status: 'RESOLVED'`** (conforme `ADR-0006` §4 e `PRD.md` §15.6).

6. **`DN-06` — Pausas `WAITING_INFO` e Marcos em `FeedbackCycle` com Retomada Automática:**
   - `FeedbackCycle` recebe campos opcionais não-indexados compatíveis com registros `v2` existentes:
     - `waitingInfoPauses?: readonly SlaPauseInterval[]`;
     - `firstResponseWarningAt?: IsoDateTime`;
     - `firstResponseBreachedAt?: IsoDateTime`;
     - `resolutionWarningAt?: IsoDateTime`;
     - `resolutionBreachedAt?: IsoDateTime`;
     - `escalatedAt?: IsoDateTime`.
   - Ao transicionar um ciclo para `WAITING_INFO`, registra-se um intervalo aberto `{ startedAt: now }` em `waitingInfoPauses` (aplicável exclusivamente ao cálculo de `RESOLUTION`, nunca a `FIRST_RESPONSE`).
   - Quando o **autor** envia uma `FeedbackMessage` enquanto o feedback/ciclo encontra-se em `WAITING_INFO`, o serviço retoma automaticamente o estado para **`IN_PROGRESS`**, fechando a pausa aberta com `endedAt: now` na mesma transação atômica.

7. **`DN-07` — Exportação Segmentada Nativa (JSON e CSV):**
   - A exportação protegida por **`PERMISSION_CODES.FEEDBACK_EXPORT`** respeita estritamente a visibilidade de cada feedback (`FEEDBACK_VIEW` item-a-item) e **filtra notas internas e anexos com `internalNoteId` com base em `FEEDBACK_INTERNAL_NOTE_VIEW`** (aplicando ainda o reforço `isFeedbackAuthor && role !== 'ADMIN'` de `DN-04`).
   - Os formatos suportados na Fase 09 são **JSON e CSV nativos** (sem bibliotecas externas), gerando `AuditEvent` (`category: AUDIT_CATEGORIES.EXPORT`) e preservando PDF/XLSX exclusivamente para a Fase 10 (`reports`).

8. **`DN-08` — Rotas Protegidas, Navegação `AppShell` e Catálogo `FEEDBACK_MODULE_KEYS`:**
   - O roteador (`src/app/router/routes.tsx`) expõe sob `<RequireAuth />` as rotas **`/feedback`**, **`/feedback/:feedbackId`** e **`/feedback/governance`** (governança de categorias, motivos de contestação, SLA organizacional e disparo de avaliação).
   - O `AppShell` (`src/app/layout/app-shell.tsx`) adiciona entrada `nav.feedback` visível para usuários autenticados com organização ativa (já que `FEEDBACK_CREATE` é universal para membros ativos e `FEEDBACK_VIEW` filtra os itens do próprio autor ou atribuídos/administrados).
   - O domínio de `feedback` define o catálogo puro **`FEEDBACK_MODULE_KEYS`** (`readonly` / `as const`) e **`FeedbackModuleKey`** em `src/modules/feedback/domain/feedback.ts` (reexportado por `src/modules/feedback/index.ts`), evitando qualquer importação cruzada dos demais módulos do sistema.

---

### 2. Sincronização Atômica de Contestação, Filtragem Item-a-Item e Anexos Binários

1. **Sincronização Atômica `FeedbackContest.delegatedAnalystUserId` ↔ `PermissionGrant`:**
   - Ao delegar (ou reatribuir/remover) a análise de uma contestação (`delegateFeedbackContestAnalysis`), a atualização de `FeedbackContest.delegatedAnalystUserId` e a criação/revogação do respectivo `PermissionGrant` (`permission: PERMISSION_CODES.FEEDBACK_CONTEST_ANALYZE`, `scopeType: PERMISSION_SCOPE_TYPES.RESOURCE`, `scopeId: feedbackId` — ou vinculado ao `feedbackId` compatível com `doesScopeMatchResource`) ocorrem **atomicamente dentro da mesma `TransactionPort.run`** sobre `[FEEDBACK_CONTESTS, PERMISSION_GRANTS, AUDIT_EVENTS]`.
   - Se já houver um analista delegado anterior distinto, seu `PermissionGrant` específico daquela delegação é revogado imediatamente na mesma transação; da mesma forma, quando a contestação é decidida e encerrada (`CLOSED`), o grant temporário de análise pode ser encerrado ou mantido conforme ciclo de vida da delegação, sendo proibido delegar ao próprio autor não-`ADMIN` ou a usuário sem vínculo `ACTIVE` (ou papel `MEMBER` quando política exigir `ADMIN`/`MANAGER`).

2. **Filtragem Item-a-Item por `FEEDBACK_VIEW` Antes de Contagens:**
   - Listagens, painéis de resumo e contadores por status retornam e totalizam **exclusivamente** os feedbacks para os quais `evaluateAuthorization` autoriza **`PERMISSION_CODES.FEEDBACK_VIEW`** com contexto ABAC completo (`organizationId`, `feedbackId`, `createdBy: feedback.authorUserId`, `assigneeId: feedback.assigneeId`).
   - Nenhum metadado agregado ou existência de feedback fora do escopo (incluindo contagens totais de feedbacks de terceiros para `MEMBER` ou `MANAGER` não atribuído) pode vazar antes da filtragem item-a-item.

3. **Anexos Binários, Quotas, SHA-256 e `QuotaExceededError`:**
   - **Cálculo SHA-256 fora de `TransactionPort.run`:** o digest SHA-256 (`checksumSha256`) é computado antes da abertura da transação IndexedDB/Dexie (Web Crypto `crypto.subtle.digest('SHA-256', bytes)` com fallback determinístico em ambiente sem SubtleCrypto se necessário), nunca dentro da transação Dexie (`DATA-PERSISTENCE.md`, `ADR-0007`).
   - **Validação de tipo e quota:** todo upload executa `validateAttachmentQuota` (`DISALLOWED_ATTACHMENT_MIME_TYPES`, `MAX_ATTACHMENT_SIZE_BYTES = 15 MB` por arquivo e `MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES = 50 MB` acumulado no contexto do feedback/nota/mensagem, respeitando também `OrganizationSettings.pendingPermissionDefaults` quando mais restritivo).
   - **Revalidação no download:** ao baixar um anexo (`downloadFeedbackAttachment`), o serviço revalida `FEEDBACK_VIEW` (e `FEEDBACK_INTERNAL_NOTE_VIEW` se `internalNoteId !== undefined`), verifica `isDisallowedAttachmentMimeType(attachment.mimeType)` e valida consistência `organizationId` / integridade do blob em `AttachmentBlobStorePort`.
   - **Borda HTTP/MSW:** payloads binários trafegam codificados em Base64 na borda JSON do MSW v2, sendo convertidos para `Uint8Array` antes da camada de persistência.
   - **Tratamento não-destrutivo de `QuotaExceededError`:** falhas de cota do IndexedDB são traduzidas por `withPersistenceErrorHandling` em `InfrastructureError` (`reason: 'STORAGE_QUOTA_EXCEEDED'`) com diagnóstico via `estimateStorageDiagnostic()`, **sem jamais apagar dados existentes automaticamente**.

---

### 3. Schema Dexie `v2`, Extensões de Domínio/Portas/Repositórios e `FeedbackContextPort`

1. **Schema Dexie `v2` (`51` tabelas) 100% preservado:**
   - Nenhuma tabela ou índice é adicionado ou alterado em `src/shared/persistence/pms-database.ts`.
   - As extensões nos repositórios Dexie utilizam exclusivamente os índices `v2` já existentes:
     - `FeedbackRepositoryPort.listByOrganization(organizationId, filters?)` suporta `{ authorUserId?, assigneeId?, status? }`, aproveitando `[organizationId+status]` quando `status` é informado;
     - `FeedbackCategoryRepositoryPort` adiciona `findByCode(organizationId, code)` (sobre `[organizationId+code]`) e `findVersionById(organizationId, versionId)`;
     - `FeedbackContestReasonRepositoryPort` adiciona `findByCode(organizationId, code)` (sobre `[organizationId+code]`) e `findVersionById(organizationId, versionId)`, além de suportar `includeDeleted?: boolean` em `listByOrganization` alinhado ao `SoftDeletable` de `FeedbackContestReason`;
     - `FeedbackContestRepositoryPort` adiciona `listByCycle(organizationId, cycleId)` (sobre `[organizationId+cycleId]`) e `listByOrganization(organizationId, filters?)` (sobre `[organizationId+status]` / `organizationId`);
     - `FeedbackSlaSnapshotRepositoryPort` adiciona `findByCycleId(organizationId, cycleId)` (sobre `[organizationId+cycleId]`);
     - `FeedbackReopenRequestRepositoryPort` adiciona `listByOrganization(organizationId, filters?)` (sobre `[organizationId+status]` / `organizationId`).

2. **Porta Local Anti-Ciclo `FeedbackContextPort`:**
   - Definida em `src/modules/feedback/application/ports/feedback-context.port.ts` (exportando `FeedbackContextPort` e `FeedbackActorProfile`) e reexportada em `src/modules/feedback/index.ts`.
   - Permite a `FeedbackService` resolver nomes, e-mails, avatares, papéis e responsáveis elegíveis (`ADMIN`/`MANAGER` ativos) sem importar `@/modules/users`.

---

### 4. DAG Acíclico no ESLint (`eslint.config.js`) e Fechamento do Backlog `[BAIXO]` da Fase 08

1. **Regras DAG obrigatórias em `eslint.config.js` (`createModuleDagDisallowPolicy`, antes da exceção `categories: 'test'`):**
   - **`feedback`** é **PROIBIDO** de importar `['tasks', 'projects', 'kanban', 'dependencies', 'impediments', 'focus', 'bottlenecks', 'analytics', 'notifications', 'backups', 'teams', 'invitations', 'authentication', 'demo', 'onboarding', 'users']`.
   - **`projects`** é **PROIBIDO** de importar `['teams', 'kanban', 'bottlenecks', 'feedback']` (**incorporando e fechando o item de backlog `[BAIXO]` da Fase 08: `projects` !-> `bottlenecks`**).
   - **`tasks`** é **PROIBIDO** de importar `['projects', 'kanban', 'feedback']`.
   - **`dependencies`** e **`impediments`** são **PROIBIDOS** de importar `['tasks', 'projects', 'kanban', 'feedback']`.
   - **`bottlenecks`** é **PROIBIDO** de importar `['focus', 'tasks', 'projects', 'kanban', 'dependencies', 'impediments', 'analytics', 'feedback']`.
   - **`focus`** é **PROIBIDO** de importar `['tasks', 'projects', 'kanban', 'dependencies', 'impediments', 'analytics', 'feedback']`.
   - **`authorization`** permanece 100% isolado como módulo-folha (`ADR-0006`).
2. **Validação automatizada em `src/test/architecture-boundaries.test.ts`:**
   - Testes negativos verificam bloqueio de importações proibidas por `feedback`, de `projects -> bottlenecks`/`feedback`, e de `tasks`/`dependencies`/`impediments`/`focus`/`bottlenecks -> feedback`, preservando arquivos `*.test.ts(x)` válidos.

---

### 5. Contratos de Endpoints Simulados (MSW v2) e Interface

1. **Superfície HTTP simulada sob `/api/v1/organizations/:organizationId/feedbacks*`:**
   - Todos os handlers MSW delegam integralmente a `FeedbackService` (sem regras de negócio nos handlers), propagam `x-correlation-id` e `x-actor-user-id`, validam autorização real via `@/modules/authorization` e aguardam `TransactionPort.run` + `PostCommitDomainEventBus` antes de responder:
     - `GET/POST .../feedbacks` e `GET .../feedbacks/:feedbackId`;
     - `POST .../feedbacks/:feedbackId/assign`, `PATCH .../feedbacks/:feedbackId/status`, `PATCH .../feedbacks/:feedbackId/triage` (prioridade/categoria);
     - `POST .../feedbacks/:feedbackId/messages`, `POST .../feedbacks/:feedbackId/internal-notes`;
     - `POST .../feedbacks/:feedbackId/attachments` e `GET .../feedbacks/:feedbackId/attachments/:attachmentId/download` (Base64 na borda);
     - `POST .../feedbacks/:feedbackId/confirm-resolution`, `POST .../feedbacks/:feedbackId/contests`, `POST .../feedbacks/:feedbackId/contests/:contestId/delegate`, `POST .../feedbacks/:feedbackId/contests/:contestId/analysis`, `POST .../feedbacks/:feedbackId/contests/:contestId/decision`;
     - `POST .../feedbacks/:feedbackId/reopen-requests`, `POST .../feedbacks/:feedbackId/reopen-requests/:requestId/decision`;
     - `GET .../feedbacks/export` (JSON/CSV nativos);
     - `POST .../feedbacks/evaluate-sla`;
     - `GET/POST/PATCH/DELETE .../feedback-categories*`, `GET/POST/PATCH/DELETE .../feedback-contest-reasons*` e `PATCH .../settings/feedback-sla` (`FEEDBACK_SLA_MANAGE`).
2. **Rotas de Apresentação (`ACCESSIBILITY.md`, `DN-08`):**
   - `/feedback`, `/feedback/:feedbackId` e `/feedback/governance` sob `<RequireAuth />` e `AppShell` (`nav.feedback`), com suporte integral a teclado, contraste WCAG AA e regiões `aria-live="polite"`.

## Alternativas Consideradas

1. **Criar migração Dexie `v2 -> v3` para adicionar novas stores de pausas SLA ou versões de SLA:** descartada porque `PMS_SCHEMA_V2_STORES` (`51` tabelas) já contempla todas as 14 stores `feedback*` e `attachmentBlobs`; campos opcionais não-indexados em `FeedbackCycle` (`waitingInfoPauses?` e marcos SLA) mantêm retrocompatibilidade total sem migração.
2. **Permitir que `GET /feedbacks*` persista marcos SLA e auto-encerramentos por efeito colateral:** descartada (`DN-05`) porque leituras HTTP devem permanecer idempotentes e livres de efeitos colaterais transacionais; o disparo explícito `POST .../feedbacks/evaluate-sla` garante atomicidade, deduplicação e auditabilidade.
3. **Importar `users` ou `projects` diretamente em `feedback` para montar seletores de módulo e nomes de autores/responsáveis:** descartada para preservar o DAG acíclico estrito (`FEEDBACK_MODULE_KEYS` em domínio + `FeedbackContextPort` anti-ciclo conectado na camada `src/app/composition/`).
4. **Suportar exportação PDF/XLSX já na Fase 09 via bibliotecas externas:** descartada (`DN-07`) para manter `package.json` / `pnpm-lock.yaml` inalterados e concentrar exportações binárias ricas na Fase 10 (`reports`).

## Consequências

- **Positivas:** Schema Dexie `v2` (`51` tabelas) e `src/modules/authorization/**` 100% preservados; zero novas dependências NPM; DAG acíclico mecanicamente protegido no ESLint e testado em `src/test/architecture-boundaries.test.ts` (incluindo encerramento do `[BAIXO]` Fase 08 `projects` !-> `bottlenecks`); isolamento rigoroso de notas internas e anexos internos contra autores não-`ADMIN`; sincronização atômica entre delegação de contestação e `PermissionGrant`; suporte completo a SLA contínuo/comercial e pausas `WAITING_INFO`.
- **Trade-offs:** exige adaptador de composição em `src/app/composition/` implementando `FeedbackContextPort` sobre `users` e `organizations`; exige disparo explícito de `POST .../feedbacks/evaluate-sla` (ou acionamento controlado na UI/fluxos) para materializar marcos SLA e auto-encerramentos por expiração no Dexie.
