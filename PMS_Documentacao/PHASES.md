# Fases de implementação

  Fase   Escopo                                             Dependências
  ------ -------------------------------------------------- ----------------
  01     Fundação, configuração e arquitetura               ---
  02     Domínio, entidades e contratos                     01
  03     Dexie, IndexedDB, repositórios e MSW               01--02
  04     Autenticação, usuários e organizações              02--03
  05     Convites, equipes e permissões                     04
  06     Projetos, participantes e Kanban                   05
  07     Tarefas, subtarefas, dependências e impedimentos   06
  08     Modo Foco, produtividade e gargalos                07
  09     Feedback, SLA e contestações                       04--05, 02--03
  10     Analytics, dashboards e relatórios                 07--09
  11     Notificações, auditoria e busca                    04--10
  12     Backups, lixeira, configurações e onboarding       03--11
  13     PWA, monitoramento, acessibilidade e otimizações   01--12
  14     Homologação e publicação                           01--13

## Aprovação

Cada fase exige objetivos, critérios, testes, evidências, revisão,
relatório e aprovação explícita. Dependências podem ser refinadas pelo
orquestrador, sem violar sequência necessária.
