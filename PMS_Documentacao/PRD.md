# PRD --- Project Management System (PMS)

**Status:** Especificação consolidada para implementação incremental\
**Produto:** Project Management System (PMS), nome provisório\
**Tipo:** Protótipo funcional frontend\
**Idioma inicial:** Português brasileiro (pt-BR)

# 1. Visão do produto

O PMS é uma aplicação multi-organização para planejar, distribuir,
executar e acompanhar projetos e tarefas. Utiliza quadros Kanban
personalizáveis e oferece produtividade, Modo Foco, identificação de
gargalos, Analytics, notificações, auditoria e gestão estruturada de
feedbacks.

O produto busca centralizar o trabalho das equipes, aumentar a
transparência do andamento, reduzir conflitos de responsabilidade e
prazos e oferecer indicadores consistentes para tomada de decisão.

# 2. Objetivos

-   Centralizar projetos, equipes, tarefas e atividades.
-   Permitir acompanhamento por Kanban e visão individual.
-   Controlar responsabilidades, prazos, dependências e impedimentos.
-   Identificar gargalos e sobrecarga por regras determinísticas.
-   Disponibilizar Analytics por projeto e organização, respeitando
    permissões.
-   Estruturar feedbacks com SLA, comunicação, contestações e
    reaberturas.
-   Preservar histórico e auditoria das operações relevantes.
-   Demonstrar fluxos funcionais em frontend sem depender de backend
    real.

# 3. Escopo e limites

## 3.1 Incluído

-   React + TypeScript + Vite.
-   Multi-organização lógica.
-   Autenticação e autorização simuladas.
-   Organizações, convites, usuários, equipes e projetos.
-   Kanban, tarefas, subtarefas, dependências e impedimentos.
-   Modo Foco e pontuação de produtividade.
-   Feedbacks, mensagens, anexos, SLA, contestação e reabertura.
-   Analytics, dashboards, relatórios e exportação.
-   Notificações, auditoria, lixeira, backup e restauração.
-   PWA e consultas/operações locais compatíveis com IndexedDB.
-   Ambiente demonstrativo isolado.

## 3.2 Fora do escopo

-   Backend real e banco remoto.
-   Autenticação segura no servidor.
-   Sincronização multiusuário ou entre dispositivos.
-   Envio real de e-mails.
-   Armazenamento remoto de arquivos.
-   Monitoramento real de servidores.
-   Fila de sincronização offline com resolução de conflitos
    distribuídos.
-   Segurança contra manipulação direta pelo proprietário do navegador.

# 4. Usuários e papéis

Papéis organizacionais fixos: - `ADMIN`: administração da organização. -
`MANAGER`: gestão dentro do escopo de projetos e equipes autorizados. -
`MEMBER`: execução e participação.

Um usuário pode pertencer a várias organizações e possuir papel
diferente em cada uma. Novos cadastros recebem `MEMBER`. O criador de
organização recebe `ADMIN` naquela organização. Convites criam
associação `MEMBER` por padrão.

# 5. Multi-organização

-   Dados organizacionais são isolados por `organizationId`.
-   Usuários podem pertencer a múltiplas organizações.
-   O seletor de organização altera o contexto ativo.
-   Sair de uma organização não encerra a sessão global.
-   Nenhuma relação entre organizações distintas é permitida sem fluxo
    explícito e autorizado.
-   Toda consulta e mutação organizacional verifica associação e escopo.

# 6. Autenticação e sessões

-   Login por e-mail e senha simulados.
-   Cadastro com validação, confirmação e aceite de termos.
-   Papel inicial `MEMBER`.
-   Recuperação de sessão local.
-   Access token simulado em memória; representação de sessão
    persistente controlada no IndexedDB, sem token secreto em
    LocalStorage.
-   Sessões por dispositivo, revogação individual/global e eventos de
    autenticação.
-   Opção de sessão persistente ou temporária.
-   Expiração e recuperação de sessão simuladas.
-   Recuperação de senha e verificação de e-mail não enviam mensagens
    reais.
-   Rotas protegidas melhoram UX, mas autorização real é validada nos
    casos de uso.

# 7. Organizações, convites e equipes

## 7.1 Organizações

-   Criar organização ou ingressar por convite após cadastro.
-   Criador torna-se administrador da organização criada.
-   Organização demonstrativa isolada.

## 7.2 Convites

-   E-mail simulado, código e link.
-   Validade padrão de 15 dias, configurável.
-   Estados: pendente, aceito, expirado e revogado.
-   Apenas administradores gerenciam convites.
-   Usuários autenticados podem aceitar convites válidos.
-   Convite aceito não pode ser reutilizado.

## 7.3 Equipes

-   Usuário pode participar de várias equipes.
-   Relação N:N.
-   Admins e gestores autorizados criam/editam e gerenciam
    participantes.
-   Gestores não excluem equipes.
-   Arquivamento impede novas associações, sem excluir projetos.
-   Remoção não apaga associação organizacional nem autoria histórica.

# 8. Projetos e participantes

-   Projeto pode existir sem equipe; `teamId` opcional.
-   Cada projeto possui quadro Kanban principal.
-   Admin controla projetos da organização.
-   Gestor administra projetos dos quais participa ou pelos quais é
    responsável.
-   Criador é responsável inicial.
-   Participantes são usuários da mesma organização.
-   Remoção de participante exige tratar responsabilidades pendentes e
    revoga permissões vinculadas.
-   Projetos podem ser arquivados e restaurados por usuários
    autorizados.
-   Arquivados não aceitam novas operações operacionais.

# 9. Kanban

-   Quadro personalizável por projeto.
-   Criar, editar, reordenar e configurar colunas.
-   Identificadores independentes dos nomes.
-   Colunas inicial e final identificadas.
-   Pelo menos uma coluna operacional e uma coluna de conclusão.
-   Drag and Drop com dnd-kit, mouse, teclado e touch.
-   WIP por coluna.
-   Todas as tarefas presentes contam para WIP, inclusive bloqueadas.
-   Concluídas/removidas deixam de ocupar WIP.
-   Exceder WIP é bloqueado por padrão; exceção autorizada exige
    justificativa e auditoria.
-   Coluna com tarefas não pode ser excluída diretamente: exige
    transferência para coluna válida.
-   Projeto arquivado impede movimentações.

# 10. Tarefas e subtarefas

Tarefa inclui: ID, título, descrição, organização, projeto, responsável
principal, participantes, prioridade, datas, status, subtarefas,
dependências, etiquetas, comentários, anexos e histórico.

-   Membros editam/movimentam tarefas das quais são responsáveis ou
    participantes, conforme permissões.
-   Membros não alteram estrutura do projeto/quadro.
-   Responsável principal, participantes e responsáveis de subtarefas
    são conceitos distintos.
-   Subtarefas possuem um nível hierárquico; não podem ter subtarefas
    próprias.
-   Conclusão da tarefa exige conclusão ou cancelamento autorizado das
    subtarefas obrigatórias.
-   Pausa registra início, autor, justificativa e encerramento.
-   Tarefa pausada não é movimentada normalmente sem retomada ou exceção
    autorizada.
-   Cancelamento é distinto de conclusão e exige justificativa.
-   Membros podem solicitar cancelamento; execução é restrita a
    admins/gestores autorizados.
-   Restauração valida dependências, permissões, quadro e WIP.
-   Alterações de prazo registram valor anterior/novo, autor e data;
    justificativa quando aplicável.

# 11. Dependências e impedimentos

-   Tarefas podem depender de várias outras.
-   Impedir ciclos diretos e indiretos.
-   Dependências obrigatórias pendentes impedem conclusão.
-   Exceção exige autorização e justificativa.
-   Impedimentos possuem categoria, gravidade, descrição, responsável e
    estado.
-   Categorias: dependência externa, problema técnico, falta de
    informação, indisponibilidade de recursos, aguardando aprovação,
    comunicação e outros.
-   Gravidades: baixa, média, alta e crítica.
-   Estados: aberto, em resolução, resolvido e cancelado.
-   Resolver impedimento não conclui tarefa.

# 12. Inatividade, gargalos e carga

## 12.1 Inatividade

-   Configuração por projeto.
-   Baseada em última movimentação.
-   `lastMovedAt` separado de `lastActivityAt`.
-   Tarefas concluídas não contam.
-   Bloqueadas são diferenciadas de inativas.
-   Admin/gestor autorizado configura.

## 12.2 Gargalos

Indicadores: WIP, inatividade, atrasos, impedimentos e sobrecarga.
Classificação: baixa, moderada, alta e crítica. Regras determinísticas e
limiares centralizados/configuráveis. Alertas equivalentes são
atualizados em vez de duplicados. Reconhecimento não significa
resolução.

## 12.3 Carga de trabalho

Pontuação ponderada inicial 0--100: - Prioridade 30%. - Atraso 30%. -
Impedimentos 25%. - Situação operacional 15%.

Tarefas concluídas/canceladas não compõem carga ativa. Pausadas
permanecem com redução inicial de 50%, sujeita a calibração. Tarefas com
múltiplos participantes distribuem contribuição igualmente por padrão,
totalizando 100%. Subtarefas são calculadas independentemente. Faixas:
baixa 0--24, moderada 25--49, alta 50--74, crítica 75--100. A pontuação
não representa horas ocupadas.

# 13. Modo Foco

Pontuação inicial: - Prioridade oficial 30%. - Prazo/atraso 30%. -
Dependências disponíveis 20%. - Inatividade 10%. - Compatibilidade com
carga 10%.

Tarefas bloqueadas ficam em seção separada com motivo e condição para
desbloqueio. Fixar, remover da visualização e reordenar afeta somente a
experiência individual, não o Kanban nem a prioridade oficial.
Alternância automático/manual. Algoritmo determinístico e explicável.

# 14. Analytics e métricas

Dois níveis: projeto e organização. Acesso segmentado: - Admin: visão
organizacional e projetos. - Gestor: projetos administrados. - Membro:
projetos dos quais participa; sem visão organizacional global.

Indicadores: tarefas criadas/concluídas/pendentes/em
andamento/atrasadas, Lead Time, Cycle Time, Throughput, taxa de
conclusão, impedimentos, gargalos e carga.

Definições: - Lead Time: criação até conclusão. - Cycle Time: início
efetivo até conclusão. - Throughput: ciclos concluídos no período. -
Tarefas únicas: IDs distintos. - Reabertura cria novo ciclo; preservar
ciclos anteriores. - Tempo total e efetivo, descontando pausas. - Taxa
de conclusão por coorte de tarefas criadas no período; conclusões no
período, independentemente da criação, são indicador separado. -
Períodos: 7, 30, 90 dias, ano atual e intervalo personalizado. -
Comparar períodos equivalentes. - Dados insuficientes são indisponíveis,
não zero. - Fórmulas oficiais padronizadas, filtros/dimensões
personalizáveis, sem fórmula livre. - Dashboards individuais, sem
compartilhamento, preferências por usuário/organização e catálogo
conforme permissões. - Edição com salvar/descartar e alerta de
alterações não salvas. - Revalidar autorização na consulta e
renderização.

# 15. Feedbacks e atendimento

## 15.1 Cadastro e categorias

Feedback contém usuário, organização, módulo, categoria, descrição,
data, prioridade, estado, responsável, mensagens, anexos, histórico e
ciclos.

Categorias iniciais: - Bug/Erro. - Melhoria. - Nova funcionalidade. -
Usabilidade. - Desempenho. - Segurança. - Dúvida/Suporte. - Outros.

Categorias são obrigatórias e administráveis por organização.
Administradores criam, editam, ativam, desativam, reativam e ordenam.
Categorias versionadas; cada feedback preserva a versão utilizada.
Categorias utilizadas não são excluídas; somente desativadas. Categorias
nunca utilizadas podem ser excluídas logicamente. Histórico completo
comparativo e auditoria.



> **Contrato normativo de autorização:** a matriz detalhada RBAC + ABAC, códigos de permissão, regras de escopo, concessões, precedência de negações e cenários mínimos de aceite estão definidos em [`docs/contracts/permission-matrix.md`](docs/contracts/permission-matrix.md). Em caso de divergência de interpretação, não ampliar permissões por inferência: aplicar Default Deny e registrar a decisão pendente.

## 15.2 Permissões e atribuição

-   Membros enviam e consultam apenas os próprios feedbacks.
-   Admins consultam e gerenciam todos da organização.
-   Admins atribuem a admins/gestores.
-   Gestores consultam apenas feedbacks atribuídos.
-   Responsável acompanha e atualiza feedback atribuído.
-   A atribuição não altera papel organizacional.
-   Comentários internos separados das mensagens públicas.
-   Mensagens públicas e notas internas são imutáveis; correções por
    novas mensagens.
-   Anexos seguem limites gerais.

## 15.3 Estados

Recebido, Em análise, Atribuído, Em atendimento, Aguardando informações,
Resolvido e Encerrado.

## 15.4 Comunicação

Mensagens bidirecionais entre autor e responsável, com anexos.
Comentários internos somente por admins/responsáveis autorizados,
invisíveis ao autor. Menções `@` apenas em comentários internos e não
concedem acesso.

## 15.5 SLA

-   Configurável por prioridade para primeira resposta e resolução.
-   Primeira resposta não pausa.
-   SLA de resolução pausa em Aguardando informações e retoma quando
    autor responde.
-   Calendário organizacional: horas corridas ou horário comercial,
    dias, intervalos e feriados.
-   Snapshot do calendário na criação do ciclo.
-   Mudança de prioridade não altera SLA em andamento.
-   Alertas preventivos e vencimentos, sem duplicação.
-   Escalonamento sinaliza para admin, sem trocar responsável
    automaticamente.

## 15.6 Resolução e manifestação

-   Resolução exige descrição obrigatória.
-   Autor pode confirmar ou contestar.
-   Ausência de resposta não equivale a confirmação.
-   Prazo de manifestação e prazo para contestação são controles
    independentes, configuráveis por organização, com snapshots na
    resolução.
-   Contestação válida impede encerramento automático enquanto estiver
    pendente.
-   Sem contestação pendente e expirados os prazos aplicáveis, feedback
    encerra automaticamente, mantendo estado `Resolvido`.
-   Contestação durante prazo continua válida após vencimento.

## 15.7 Contestações

-   Motivo obrigatório e justificativa textual obrigatória.
-   Motivos iniciais: solução não resolveu; parcialmente aplicada;
    problema voltou; solução diferente da solicitada; problema continua;
    novas evidências; discordância; outros.
-   Catálogo por organização, versionado, auditável e administrável.
-   Cada contestação vinculada ao ciclo e à resolução específica.
-   Análise pode ser delegada a admin/gestor autorizado; decisão final
    somente admin.
-   Parecer estruturado imutável: manter resolução ou retomar
    atendimento.
-   Admin pode contrariar parecer mediante justificativa.
-   Histórico completo cronológico, visibilidade segmentada.
-   Exportação PDF, CSV, XLSX e JSON, respeitando permissões.
-   Decisão administrativa encerra automaticamente contestação.
-   Rejeição mantém `Resolvido`; aceitação retorna `Em atendimento`.
-   Nova contestação somente após nova resolução; sem limite fixo.
-   Cada contestação possui registro independente.

## 15.8 Reaberturas excepcionais

-   Autor pode solicitar reabertura após encerramento por expiração, com
    justificativa.
-   Admin aprova/rejeita.
-   Feedback permanece encerrado enquanto aguarda.
-   Aprovação cria novo ciclo `EXCEPTIONAL_REOPEN`, com novos SLAs.
-   Preservar responsável e prioridade anteriores como valores iniciais.
-   Admin pode substituir responsável e alterar prioridade, com
    histórico.
-   Novo ciclo segue fluxo convencional completo.
-   Reabertura após contestação cria ciclo `CONTESTATION_REOPEN`.
-   Ciclo inicial é `INITIAL`.
-   Não há limite fixo de ciclos, mas cada reabertura deve cumprir
    condições.
-   Histórico e Analytics distinguem origem, ciclos e contestações.

## 15.9 Analytics de feedback

Volumes, taxas, motivos, resultados, tempos, reincidência, desempenho
por responsável, organização e período. Preservar versões de categorias
e origem dos ciclos. Respeitar permissões.

# 16. Notificações

Central interna, preferências por usuário/organização, categorias,
prioridades, histórico, leitura individual/em massa, agrupamento e
deduplicação por identificador de evento/destinatário. Eventos somente
após persistência confirmada. E-mail simulado; sem entrega externa real.
Polling híbrido para recuperação, sem sincronização cross-device.

# 17. Auditoria

Registrar autor, organização, data/hora, categoria, tipo, recurso,
before/after, resultado, justificativa e correlation ID quando
aplicável. Não registrar senhas/tokens. Admin consulta organização;
gestor escopo dos projetos; membro sem acesso direto. Consultas e
exportações também auditadas. Exportação CSV, PDF e JSON. Histórico não
editável por usuários comuns; imutabilidade apenas lógica local.

# 18. Ambiente demonstrativo

-   Organização demonstrativa isolada.
-   Acesso sem cadastro e pelo seletor de organizações.
-   Perfis ADMIN, MANAGER e MEMBER com seleção visual e credenciais
    fictícias.
-   Mesmos serviços e regras de negócio.
-   Banner e etiqueta permanentes.
-   Dados sintéticos determinísticos.
-   Restauração completa com backup preventivo, transação, validação e
    rollback.
-   Autorização de manutenção separada de ADMIN comum.
-   Histórico de manutenção independente e permanente.
-   Dashboards demonstrativos separados dos reais.

# 19. Relatórios, exportação e importação

Exportação: CSV, PDF, XLSX e JSON, conforme módulo. Pré-visualização
utiliza mesmo snapshot, filtros e permissões do arquivo. JSON versionado
preserva IDs/relacionamentos. Importação com preview,
substituição/mesclagem controlada, validação, backup, transação,
rollback e auditoria. Não realizar transferência entre organizações sem
processo explícito.

# 20. Lixeira e backups

-   Exclusão lógica com `deletedAt`, `deletedBy`, motivo quando
    aplicável.
-   Admin vê lixeira da organização e restaura/exclui definitivamente.
-   Gestor atua no escopo de projetos; restaura, sem exclusão
    definitiva.
-   Membro vê/restaura apenas registros próprios quando permitido.
-   Backup diário automático, manter últimas 7 versões automáticas;
    manuais preservados.
-   Backup local não substitui cópia externa.
-   Restauração substitui organização, exige backup preventivo e
    validação transacional.
-   Nunca restaurar dados de outra organização por engano.

# 21. Busca, onboarding e ajuda

Busca global avançada e contextual, agrupada por tipo, com relevância,
filtros e autorização. Onboarding adaptado a perfil, progresso
persistido, retomada e etapas puláveis não obrigatórias. Central de
ajuda com artigos, tutoriais, FAQs e dicas contextuais.

# 22. Requisitos não funcionais

-   TypeScript estrito.
-   Arquitetura modular em camadas.
-   Mobile-first e responsivo.
-   WCAG 2.2 AA como objetivo.
-   Chrome, Edge, Firefox e Safari recentes.
-   Lazy loading e code splitting.
-   Paginação, virtualização quando necessário e índices Dexie.
-   PWA instalável.
-   Logs técnicos com retenção de 30 dias.
-   Tratamento de erros centralizado.
-   Observabilidade local.
-   pnpm, Vite, GitHub Actions, Vercel.
-   SemVer.
-   MIT, respeitando licenças de dependências.
-   i18n com react-intl; pt-BR inicial.

# 23. Stack tecnológica

React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Tabler Icons, React
Router, React Hook Form, Zod, Context API, Dexie, IndexedDB, dnd-kit,
Vitest, React Testing Library, Playwright, ESLint, Prettier, MSW,
Recharts, FormatJS/react-intl, pnpm, GitHub Actions e Vercel.

# 24. Critérios gerais de aceite

-   Fluxos críticos funcionam por perfil e organização.
-   Isolamento multi-organização validado por testes negativos.
-   Regras de domínio não dependem de React.
-   Persistência e migrações testadas.
-   Operações críticas são transacionais/idempotentes quando aplicável.
-   Auditoria e notificações são geradas após sucesso.
-   Métricas reproduzíveis com dados sintéticos.
-   Exportação respeita permissões.
-   PWA preserva dados durante atualização.
-   Testes unitários, integração e E2E aprovados.
-   Documentação atualizada.
-   Limitações do protótipo explicitadas.

# 25. Plano de implementação

14 fases: 01 Fundação; 02 Domínio/contratos; 03 Persistência/serviços;
04 Autenticação/organizações; 05 Convites/equipes/permissões; 06
Projetos/Kanban; 07 Tarefas/dependências/impedimentos; 08
Foco/produtividade/gargalos; 09 Feedback/SLA/contestações; 10
Analytics/dashboards/relatórios; 11 Notificações/auditoria/busca; 12
Backups/lixeira/configurações/onboarding; 13
PWA/monitoramento/acessibilidade; 14 Homologação/publicação.

Cada fase exige checklist, evidências, revisão e aprovação explícita.
