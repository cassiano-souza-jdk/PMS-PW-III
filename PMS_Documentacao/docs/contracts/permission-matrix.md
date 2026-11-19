# Contrato de autorização — Matriz RBAC + ABAC

**Status:** especificação consolidada para implementação do protótipo frontend local  
**Versão:** 1.0  
**Escopo:** autorização funcional dentro da aplicação; não representa segurança de servidor.

## 1. Objetivo e princípios

Este documento define as permissões por recurso e ação. Toda operação protegida deve passar por uma política central de autorização no caso de uso/serviço. Componentes de interface podem ocultar ou desabilitar ações, mas nunca são a fonte de verdade da autorização.

Princípios obrigatórios:

1. **Default Deny:** ausência de regra explícita resulta em negação.
2. **Deny Overrides:** uma restrição explícita prevalece sobre qualquer concessão.
3. **Menor privilégio:** conceder somente o necessário para o escopo e período necessários.
4. **Isolamento organizacional:** o usuário precisa possuir associação ativa à organização proprietária do recurso.
5. **Escopo explícito:** permissões são avaliadas no contexto da organização e, quando aplicável, projeto, equipe ou recurso.
6. **Autorização no serviço:** toda leitura protegida e toda mutação devem validar autorização no serviço/caso de uso.
7. **Sem confiança na UI:** IDs, rotas, filtros, estado local ou controles visuais não comprovam autorização.
8. **Auditoria:** concessões, revogações e operações administrativas sensíveis geram eventos auditáveis.
9. **Separação de manutenção:** permissões de manutenção da demonstração não decorrem automaticamente do papel ADMIN ou MANAGER.
10. **Limite do protótipo:** essas regras simulam controles no cliente. Não garantem proteção contra usuário que manipule o próprio navegador ou armazenamento local.

## 2. Papéis organizacionais

Os papéis são atribuídos por associação `OrganizationMember`, não globalmente ao usuário.

| Papel | Autoridade-base |
|---|---|
| `ADMIN` | Administração da organização e dos recursos pertencentes a ela, respeitadas permissões especiais e operações de manutenção separadas. |
| `MANAGER` | Gestão operacional somente dos projetos e equipes explicitamente atribuídos ou administrados. Não possui administração irrestrita da organização. |
| `MEMBER` | Consulta de recursos dos quais participa e execução de tarefas nas quais é responsável ou participante, conforme ação e estado. |

Um mesmo usuário pode possuir papéis diferentes em organizações distintas. O criador de uma organização recebe `ADMIN` naquela organização. Novos cadastros e convites aceitos recebem `MEMBER` por padrão, salvo alteração administrativa explícita e autorizada.

## 3. Atributos ABAC obrigatórios

A decisão deve considerar, conforme o recurso:

- `actor.userId`: usuário autenticado da operação.
- `actor.organizationMembership`: associação ativa e papel na organização alvo.
- `actor.grants`: concessões adicionais válidas, com escopo e validade.
- `resource.organizationId`: organização proprietária do recurso.
- `resource.projectId`: projeto associado, quando aplicável.
- `resource.teamId`: equipe associada, quando aplicável.
- `resource.createdBy`: autor/criador, quando aplicável.
- `resource.assigneeId`: responsável principal, quando aplicável.
- `resource.participantIds`: participantes, quando aplicável.
- `resource.status` / `resource.archivedAt` / `resource.deletedAt`: estado operacional.
- `action`: ação exata solicitada.
- `context.now`: instante usado para verificar validade e expiração de concessões.

Atributos ausentes não devem ser interpretados como autorização. Se uma condição obrigatória não puder ser avaliada, negar a operação e registrar erro de autorização/consistência apropriado.

## 4. Regras de escopo

### 4.1 Organização

- `ADMIN`: escopo organizacional completo, exceto capacidades especiais explicitamente separadas.
- `MANAGER`: não recebe escopo organizacional global por padrão.
- `MEMBER`: não recebe escopo organizacional global por padrão.

### 4.2 Projeto

Um MANAGER possui escopo sobre um projeto quando existe vínculo ativo e explícito que o identifica como gestor/responsável do projeto ou quando o projeto está incluído em sua atribuição administrativa. Ser apenas membro/participante de projeto não equivale a ser gestor.

Um MEMBER possui acesso de leitura ao projeto quando é participante ativo do projeto, membro de equipe vinculada com acesso concedido ao projeto, ou recebeu concessão explícita compatível. A participação no projeto não concede automaticamente permissão para configurar o quadro ou administrar outros participantes.

### 4.3 Equipe

Um MANAGER administra somente equipes explicitamente atribuídas a ele. Um MEMBER consulta dados de equipes das quais é membro ativo, sem administrar sua composição ou configurações.

### 4.4 Tarefa

Para MEMBER, acesso operacional à tarefa exige que seja responsável principal ou participante ativo, ou que possua concessão explícita. O responsável principal e os participantes são relações distintas. Ser responsável por uma subtarefa não concede automaticamente controle sobre a tarefa-pai inteira.

### 4.5 Feedback

- Autor MEMBER: consulta o próprio feedback e mensagens públicas; não consulta notas internas.
- ADMIN: consulta e administra todos os feedbacks da organização.
- MANAGER: consulta e atua somente em feedbacks atribuídos a ele e dentro do escopo autorizado.
- Análise de contestação pode ser delegada; decisão final é exclusiva de ADMIN.

## 5. Matriz de permissões por recurso

Legenda:
- **A:** permitido ao ADMIN dentro da organização ativa.
- **M:** permitido ao MANAGER somente no escopo explicitamente administrado.
- **P:** permitido ao MEMBER somente quando a condição descrita na seção de regras específicas for satisfeita.
- **G:** depende de concessão adicional explícita, válida e dentro da autoridade de quem concedeu.
- **—:** negado por padrão.

A letra indica elegibilidade-base; não dispensa avaliação ABAC, estado do recurso, restrições e negações explícitas.

### 5.1 Organização, usuários e convites

| Ação | ADMIN | MANAGER | MEMBER | Condições e observações |
|---|:---:|:---:|:---:|---|
| Consultar dados gerais da organização | A | — | — | Manager/member só recebem dados mínimos necessários aos projetos e equipes acessíveis. |
| Editar nome, descrição e identidade organizacional | A | — | — | |
| Alterar configurações globais da organização | A | — | — | Inclui calendário organizacional, parâmetros de SLA e catálogos organizacionais. |
| Consultar membros da organização | A | — | — | Manager vê apenas identidades necessárias no escopo de equipes/projetos; member vê participantes relevantes. |
| Convidar usuário | A | — | — | Convites gerenciados apenas por ADMIN. |
| Revogar convite | A | — | — | |
| Alterar papel organizacional | A | — | — | Não pode remover o último ADMIN ativo sem fluxo seguro de transferência. |
| Suspender/reativar associação | A | — | — | A suspensão revoga acesso imediatamente no contexto local. |
| Remover membro da organização | A | — | — | Exige tratar participações, tarefas, concessões e histórico conforme regras de domínio. |
| Consultar perfil próprio | A | M | P | O usuário consulta seus próprios dados. |
| Editar perfil próprio | A | M | P | Campos pessoais permitidos; não altera papel ou associação. |
| Consultar perfil de outro usuário | A | M | P | Manager/member somente dados mínimos de pessoas no escopo compartilhado. |

### 5.2 Equipes

| Ação | ADMIN | MANAGER | MEMBER | Condições e observações |
|---|:---:|:---:|:---:|---|
| Listar equipes | A | M | P | Manager: equipes administradas; member: equipes das quais participa. |
| Criar equipe | A | M | — | Manager somente se a capacidade estiver delegada no escopo organizacional; a equipe criada fica sob seu escopo. |
| Consultar detalhes da equipe | A | M | P | |
| Editar nome/descrição/configuração | A | M | — | Manager apenas equipe administrada. |
| Adicionar/remover membro | A | M | — | Manager apenas equipe administrada e sem alterar associação organizacional. |
| Definir gestor/responsável da equipe | A | M | — | Manager não pode atribuir autoridade superior à sua própria. |
| Excluir equipe | A | — | — | Exclusão lógica; verificar vínculos e projetos antes da operação. |
| Arquivar/restaurar equipe | A | M | — | Manager apenas equipe administrada, se a operação não afetar escopo organizacional alheio. |

### 5.3 Projetos e participantes

| Ação | ADMIN | MANAGER | MEMBER | Condições e observações |
|---|:---:|:---:|:---:|---|
| Listar projetos da organização | A | M | P | Manager: projetos administrados; member: projetos acessíveis. |
| Criar projeto | A | M | — | Manager somente com capacidade de criação delegada; projeto deve permanecer em seu escopo. |
| Consultar projeto | A | M | P | Member precisa de participação/acesso válido. |
| Editar metadados do projeto | A | M | — | Manager apenas projeto administrado. |
| Alterar responsável/gestor do projeto | A | M | — | Manager não pode transferir para usuário fora de sua autoridade. |
| Adicionar/remover participantes | A | M | — | Manager apenas projeto administrado; participantes devem ser membros ativos da organização. |
| Consultar participantes | A | M | P | Member vê participantes do projeto acessível. |
| Arquivar/restaurar projeto | A | M | — | Manager apenas projeto administrado. |
| Excluir projeto logicamente | A | — | — | Requer confirmação e tratamento de dependências; exclusão definitiva não é automática. |
| Transferir projeto entre equipes | A | M | — | Manager somente entre equipes sob sua autoridade. |
| Exportar dados do projeto | A | M | P | Member apenas dados que já pode consultar; exportação não amplia visibilidade. |

### 5.4 Quadros Kanban e colunas

| Ação | ADMIN | MANAGER | MEMBER | Condições e observações |
|---|:---:|:---:|:---:|---|
| Consultar quadro | A | M | P | Member precisa ter acesso ao projeto. |
| Criar/editar colunas | A | M | — | Manager apenas projeto administrado. |
| Reordenar colunas | A | M | — | |
| Configurar limites WIP | A | M | — | |
| Arquivar coluna | A | M | — | Não pode remover a coluna principal obrigatória nem descartar tarefas. |
| Excluir coluna | A | M | — | Somente se vazia ou após migração explícita e válida de tarefas; quadro principal não pode ser excluído. |
| Mover cartão entre colunas | A | M | P | Member somente tarefa própria/participante; respeitar transições, dependências, WIP e estado do projeto. |
| Reordenar cartão na coluna | A | M | P | Mesmo escopo de movimentação; não altera prioridade ou responsável implicitamente. |

### 5.5 Tarefas, subtarefas e dependências

| Ação | ADMIN | MANAGER | MEMBER | Condições e observações |
|---|:---:|:---:|:---:|---|
| Consultar tarefa | A | M | P | Member responsável/participante ou concessão válida. |
| Criar tarefa | A | M | — | Manager apenas projeto administrado. Member não cria por padrão; concessão explícita pode habilitar. |
| Editar título/descrição | A | M | P | Member apenas tarefa própria/participante e campos operacionais permitidos. |
| Alterar prioridade | A | M | P | Member somente quando permitido no projeto/concessão; mudança gera histórico. |
| Alterar prazo | A | M | P | Member somente se concedido ou se política do projeto permitir; gera histórico. |
| Alterar responsável principal | A | M | — | Manager apenas projeto administrado; responsável deve pertencer à organização e ter acesso ao projeto. |
| Adicionar/remover participantes | A | M | — | Member não gerencia participantes por padrão. |
| Editar etiquetas | A | M | P | Member pode editar etiquetas da tarefa se possuir permissão operacional; catálogo/definições globais permanecem restritos. |
| Mover tarefa | A | M | P | Verificar transição, WIP, dependências, impedimentos e projeto arquivado. |
| Iniciar tarefa | A | M | P | Member se responsável/participante e tarefa elegível. |
| Pausar/retomar tarefa | A | M | P | Member se responsável/participante; motivo obrigatório quando definido pela regra operacional. |
| Concluir tarefa | A | M | P | Respeitar subtarefas obrigatórias, dependências e impedimentos bloqueantes. |
| Cancelar tarefa | A | M | — | Member não cancela tarefa por padrão; concessão pode habilitar. |
| Reabrir tarefa concluída | A | M | — | Member pode solicitar, mas não reabrir diretamente sem concessão. |
| Criar/editar subtarefa | A | M | P | Member somente na tarefa-pai em que possui acesso e se a política permitir. |
| Atribuir responsável de subtarefa | A | M | — | Member não atribui terceiros por padrão. |
| Concluir subtarefa | A | M | P | Se responsável/participante da subtarefa e respeitando estado da tarefa-pai. |
| Criar/remover dependência | A | M | — | Manager/admin no escopo; validar ciclo e integridade. |
| Consultar dependências | A | M | P | Se puder consultar as tarefas envolvidas; ocultar detalhes não autorizados. |
| Criar/atualizar impedimento | A | M | P | Member pode registrar impedimento em tarefa acessível. |
| Resolver/encerrar impedimento | A | M | P | Member pode resolver impedimento que abriu ou da tarefa em que atua; restrições adicionais podem exigir gestor. |
| Comentar tarefa | A | M | P | Member apenas tarefa acessível; comentário não concede acesso à tarefa. |
| Editar/excluir comentário | A | M | P | Autor pode editar dentro da janela/regra definida; remoção lógica e auditada; comentários de sistema são imutáveis. |
| Anexar/consultar arquivo | A | M | P | Acesso acompanha a tarefa; validar tamanho/tipo e autoria conforme política. |
| Consultar histórico da tarefa | A | M | P | Member somente histórico de tarefa acessível; dados sensíveis de terceiros devem ser minimizados. |

### 5.6 Modo Foco, dashboards e Analytics

| Ação | ADMIN | MANAGER | MEMBER | Condições e observações |
|---|:---:|:---:|:---:|---|
| Consultar dashboard pessoal | A | M | P | Cada usuário consulta suas preferências e dados autorizados. |
| Configurar dashboard pessoal | A | M | P | Preferências individuais. |
| Consultar Analytics organizacional | A | — | — | Manager não recebe visão global por papel. |
| Consultar Analytics de projeto | A | M | P | Manager em projeto administrado; member somente widgets/dados permitidos no projeto acessível. |
| Consultar produtividade individual de terceiros | A | M | — | Manager somente pessoas/projetos sob seu escopo e conforme política de privacidade interna. |
| Consultar carga de trabalho | A | M | P | Member consulta a própria carga; terceiros somente ADMIN/MANAGER no escopo. |
| Configurar pesos/regras globais de métricas | A | — | — | Parâmetros iniciais devem ser identificados como calibráveis. |
| Configurar preferências pessoais do Modo Foco | A | M | P | Não altera parâmetros globais. |
| Consultar gargalos do projeto | A | M | P | Member vê apenas informações necessárias ao projeto acessível. |
| Configurar regras de gargalo | A | M | — | Manager somente projeto administrado quando a regra for específica do projeto. |
| Exportar Analytics | A | M | P | Aplicar exatamente o mesmo escopo e filtros autorizados da consulta. |

### 5.7 Feedback, SLA e contestações

| Ação | ADMIN | MANAGER | MEMBER | Condições e observações |
|---|:---:|:---:|:---:|---|
| Criar feedback | A | M | P | Qualquer usuário autenticado pode criar feedback para a organização ativa. |
| Consultar feedback | A | M | P | Admin: todos; manager: atribuídos; member: próprio feedback. |
| Editar dados iniciais do feedback | A | M | P | Autor somente enquanto permitido pelo estado; alterações posteriores devem ser registradas. |
| Enviar mensagem pública | A | M | P | Autor e responsáveis autorizados no ciclo. |
| Consultar mensagem pública | A | M | P | Todos os envolvidos autorizados no feedback. |
| Criar/consultar nota interna | A | M | — | Manager somente se atribuído/autorizado; nunca visível ao autor. |
| Atribuir feedback | A | — | — | Admin atribui a admin/manager elegível. |
| Alterar prioridade/categoria | A | M | — | Manager somente feedback atribuído e se delegação permitir; categoria deve respeitar catálogo versionado. |
| Alterar estado operacional | A | M | — | Manager somente no escopo atribuído e conforme transições. |
| Configurar categorias e motivos | A | — | — | Administração organizacional; versionamento obrigatório. |
| Configurar SLA/calendário | A | — | — | Snapshot aplicado ao ciclo no momento definido pelo fluxo. |
| Analisar contestação | A | M | — | Manager somente quando houver delegação explícita; análise não equivale à decisão final. |
| Decidir contestação | A | — | — | Exclusivo de ADMIN. Decisão e justificativa imutáveis. |
| Solicitar reabertura | A | M | P | Autor do feedback; reabertura excepcional após expiração sujeita à aprovação admin. |
| Aprovar/rejeitar reabertura excepcional | A | — | — | Exclusivo de ADMIN. |
| Confirmar resolução | A | M | P | Autor pode confirmar ou contestar nos prazos configurados. |
| Exportar feedback/histórico | A | M | P | Mesmo escopo de consulta; notas internas somente para quem pode consultá-las. |

### 5.8 Notificações, auditoria, relatórios e busca

| Ação | ADMIN | MANAGER | MEMBER | Condições e observações |
|---|:---:|:---:|:---:|---|
| Consultar notificações próprias | A | M | P | Cada usuário consulta apenas suas notificações. |
| Alterar preferências próprias | A | M | P | Não altera preferências de terceiros. |
| Marcar notificação como lida | A | M | P | Apenas notificações próprias. |
| Consultar auditoria organizacional | A | — | — | Manager consulta somente auditoria de projetos administrados. |
| Consultar auditoria de projeto | A | M | — | Manager apenas projeto administrado; member sem acesso direto. |
| Exportar auditoria | A | M | — | Respeitar escopo e mascaramento de dados sensíveis. |
| Consultar relatórios | A | M | P | Conteúdo limitado aos dados que o usuário pode consultar. |
| Gerar/exportar relatório | A | M | P | Exportação não amplia permissões. |
| Busca global | A | M | P | Resultados filtrados por autorização antes de serem retornados. |
| Abrir resultado da busca | A | M | P | Revalidar autorização no recurso de destino. |

### 5.9 Lixeira, backups, importação e manutenção

| Ação | ADMIN | MANAGER | MEMBER | Condições e observações |
|---|:---:|:---:|:---:|---|
| Consultar lixeira organizacional | A | — | — | Manager/member sem acesso global. |
| Consultar itens excluídos de projeto | A | M | — | Manager somente itens do projeto administrado, se a política do módulo permitir. |
| Restaurar item | A | M | — | Manager somente dentro do projeto administrado; validar integridade e permissões atuais. |
| Excluir definitivamente item | A | — | — | Ação explícita, confirmação reforçada e auditoria; sem rotina automática. |
| Criar backup manual | A | — | — | Backup local da organização/escopo suportado. |
| Consultar backups | A | — | — | |
| Restaurar backup | A | — | — | Validar versão, integridade, escopo e confirmação reforçada. |
| Importar JSON | A | — | — | Preview, validação, backup prévio, transação e rollback. |
| Exportar dados organizacionais completos | A | — | — | Exportação integral exclusiva do ADMIN. |
| Consultar eventos de manutenção demo | G | G | — | Exige permissão especial `demo.maintenance.view`, não herdada do papel. |
| Executar restauração/reset da demo | G | G | — | Exige `demo.maintenance.restore`, confirmação e registro permanente de manutenção. |

## 6. Concessões adicionais e delegação

Concessões adicionais são exceções explícitas, não alterações implícitas de papel.

Campos mínimos de uma concessão:

- `id` UUID;
- `organizationId`;
- `granteeUserId`;
- `permission` (código estável);
- `scopeType` (`ORGANIZATION`, `TEAM`, `PROJECT`, `RESOURCE`);
- `scopeId` quando aplicável;
- `grantedByUserId`;
- `grantedAt`;
- `startsAt` e `expiresAt` quando temporária;
- `revokedAt` e `revokedByUserId` quando revogada;
- `reason` obrigatório para concessões administrativas;
- `status` derivado/consistente.

Regras:

1. Concedente só pode delegar permissões que possui autoridade para delegar.
2. MANAGER não pode conceder autoridade organizacional, alterar papéis, decidir contestações ou transferir escopo que não administra.
3. MEMBER não concede permissões a terceiros.
4. Concessões temporárias expiram automaticamente na avaliação, mesmo que um processo de limpeza ainda não tenha sido executado.
5. Revogação é imediata para novas operações.
6. Remover usuário do projeto/equipe revoga concessões vinculadas àquele escopo, conforme decisão aprovada.
7. Concessão não supera `Deny` explícito, associação suspensa, recurso de outra organização ou estado incompatível.
8. Concessões e revogações são auditadas; histórico não é apagado.
9. A UI deve indicar quando uma ação depende de permissão adicional e quem pode concedê-la.

## 7. Ordem determinística de avaliação

A política deve seguir esta ordem, sem atalhos:

1. Identificar ator, ação e recurso.
2. Validar sessão/autenticação simulada.
3. Validar existência do recurso e obter sua organização proprietária.
4. Validar associação ativa do ator à organização proprietária.
5. Validar estado do recurso (ex.: não excluído, projeto não arquivado para mutações operacionais).
6. Resolver papel organizacional e escopo de projeto/equipe/recurso.
7. Localizar concessões aplicáveis e verificar escopo, autoridade do concedente e validade temporal.
8. Aplicar restrições e negações explícitas (`Deny Overrides`).
9. Aplicar a regra específica da ação.
10. Autorizar ou negar; registrar auditoria quando a ação ou tentativa for auditável.

**Falha fechada:** se a organização proprietária, o escopo ou os atributos necessários não puderem ser determinados com segurança, negar.

## 8. Regras transversais obrigatórias

- Recursos de organizações diferentes nunca podem ser relacionados, consultados ou alterados por uma mesma operação sem uma regra explícita de sistema que não existe no escopo atual.
- Consultas em lista devem filtrar por autorização antes de calcular totais, paginação, agregações ou exportações, evitando vazamento por contagem.
- Exportações devem reutilizar a política e o escopo da consulta correspondente.
- Busca deve filtrar resultados antes de exibir título, trecho, contagem ou metadados.
- Notificações não podem revelar conteúdo de recursos sem autorização atual do destinatário.
- Acesso a anexos deve revalidar autorização da entidade proprietária.
- Eventos de auditoria devem registrar ator, organização, ação, recurso, instante, resultado e correlação; não registrar senhas, tokens ou segredos.
- Operações irreversíveis exigem confirmação explícita e auditoria.
- Exclusão lógica não equivale a autorização para leitura normal; itens excluídos seguem política específica de lixeira.
- Dados demo e dados reais/autenticados devem permanecer isolados conforme o modelo de organização.

## 9. Códigos de permissão recomendados

Os códigos devem ser estáveis, em inglês, em formato `resource.action`:

- `organization.view`, `organization.update`, `organization.settings.manage`, `organization.members.view`, `organization.members.manage`, `organization.roles.manage`
- `invitation.create`, `invitation.revoke`
- `team.view`, `team.create`, `team.update`, `team.members.manage`, `team.archive`, `team.delete`
- `project.view`, `project.create`, `project.update`, `project.members.manage`, `project.archive`, `project.restore`, `project.delete`, `project.transfer`
- `board.view`, `board.configure`, `board.columns.manage`, `board.wip.manage`, `board.card.move`
- `task.view`, `task.create`, `task.update`, `task.assign`, `task.participants.manage`, `task.move`, `task.start`, `task.pause`, `task.complete`, `task.cancel`, `task.reopen`, `task.comment`, `task.attachment.manage`, `task.history.view`
- `subtask.manage`, `subtask.assign`, `subtask.complete`
- `dependency.view`, `dependency.manage`
- `impediment.create`, `impediment.view`, `impediment.resolve`
- `focus.preferences.manage`
- `analytics.personal.view`, `analytics.project.view`, `analytics.organization.view`, `analytics.export`, `analytics.rules.manage`
- `bottleneck.view`, `bottleneck.rules.manage`
- `feedback.create`, `feedback.view`, `feedback.message.create`, `feedback.internal_note.view`, `feedback.internal_note.create`, `feedback.assign`, `feedback.status.manage`, `feedback.catalog.manage`, `feedback.sla.manage`, `feedback.export`
- `feedback_contest.analyze`, `feedback_contest.decide`, `feedback_reopen.request`, `feedback_reopen.decide`
- `notification.view`, `notification.preferences.manage`
- `audit.project.view`, `audit.organization.view`, `audit.export`
- `report.view`, `report.export`, `search.execute`
- `trash.view`, `trash.restore`, `trash.delete_permanently`
- `backup.create`, `backup.view`, `backup.restore`, `data.import`, `data.export`
- `demo.maintenance.view`, `demo.maintenance.restore`

A presença de um código no catálogo não concede acesso por si só. A política combina código, papel, escopo, atributos, concessões e restrições.

## 10. Respostas de autorização e erros

Usar erro de domínio padronizado:

- `AUTHENTICATION_ERROR`: ator não autenticado ou sessão inválida.
- `AUTHORIZATION_ERROR`: ator autenticado sem permissão ou escopo.
- `NOT_FOUND`: recurso inexistente ou deliberadamente não revelado por política de não divulgação.
- `CONFLICT`: estado atual impede a operação, mesmo que o ator tenha permissão.
- `VALIDATION_ERROR`: entrada inválida.

A aplicação não deve revelar se um recurso de outra organização existe quando a política exigir não divulgação. A escolha entre `NOT_FOUND` e `AUTHORIZATION_ERROR` deve ser consistente por caso de uso e documentada nos testes.

## 11. Cenários mínimos de aceite

1. Usuário ADMIN em Organização A não acessa recurso de Organização B sem associação ativa a B.
2. Papel MANAGER em A não concede gestão organizacional em A.
3. MANAGER atribuído ao Projeto X não administra Projeto Y.
4. MEMBER participante do Projeto X consulta o quadro, mas não altera colunas ou WIP.
5. MEMBER responsável por uma tarefa pode executar somente as ações operacionais permitidas para aquela tarefa.
6. Ser responsável por subtarefa não concede automaticamente edição da tarefa-pai.
7. Remoção de participante revoga concessões vinculadas ao projeto/equipe removido.
8. Concessão expirada não autoriza operação, mesmo que ainda exista registro no IndexedDB.
9. Concessão feita por MANAGER não pode ultrapassar o escopo de autoridade do concedente.
10. `Deny` explícito prevalece sobre papel e concessão.
11. Manager só consulta feedback atribuído a ele; não consulta notas internas de feedback não atribuído.
12. Manager delegado pode analisar contestação, mas não decidir.
13. Somente ADMIN decide contestação e aprova reabertura excepcional.
14. MEMBER não consulta auditoria diretamente.
15. Busca, dashboard, contagens, relatórios e exportações não revelam recursos fora do escopo.
16. Notificação antiga não permite abrir recurso cujo acesso foi revogado.
17. ADMIN comum não executa manutenção demo sem permissão especial.
18. Operações em projeto arquivado respeitam restrições de estado, ainda que o ator seja ADMIN/MANAGER.
19. Restauração de item excluído valida novamente vínculos, escopo e integridade.
20. Tentativa negada não altera dados; ações sensíveis registram evento de auditoria apropriado.

## 12. Pendências deliberadamente parametrizáveis

Os pontos abaixo não devem ser resolvidos por suposição no código; devem ser configurações ou decisões registradas em ADR/regra de negócio antes da implementação do respectivo módulo:

- janela de edição de comentários;
- tipos, tamanho máximo e quantidade de anexos;
- se MEMBER pode criar tarefa em projetos específicos;
- se MEMBER pode alterar prioridade/prazo sem concessão;
- granularidade de permissões temporárias por campo;
- política de visibilidade de métricas individuais para gestores;
- prazo de retenção de itens na lixeira;
- confirmação reforçada e mecanismo de reautenticação (não disponível como segurança real no protótipo).

Na ausência de decisão, aplicar Default Deny para capacidades adicionais e não inventar comportamento permissivo.
