# Módulos e responsabilidades

  -----------------------------------------------------------------------
  Módulo                              Responsabilidade
  ----------------------------------- -----------------------------------
  authentication                      Login, cadastro, sessões simuladas,
                                      recuperação e logout

  users                               Perfil e dados de usuários

  organizations                       Multi-tenancy e membros

  invitations                         Convites e aceitação

  teams                               Equipes e participantes

  projects                            Projetos, arquivamento e
                                      responsáveis

  kanban                              Quadros, colunas, WIP e
                                      movimentação

  tasks                               Tarefas, subtarefas, pausas e
                                      ciclos

  dependencies                        Dependências e validação de ciclos

  impediments                         Impedimentos e resolução

  focus                               Modo Foco e preferências
                                      individuais

  analytics                           Métricas de projeto/organização

  bottlenecks                         Regras de gargalo e alertas

  feedback                            Feedback, mensagens, SLA,
                                      contestação e reabertura

  notifications                       Central, preferências, deduplicação

  audit                               Eventos de auditoria e consultas
                                      autorizadas

  reports                             Prévia, filtros e exportações

  search                              Busca global e relevância

  trash                               Exclusão lógica e restauração

  backups                             Backup, importação, exportação e
                                      recuperação

  settings                            Configurações pessoais e
                                      organizacionais

  onboarding                          Fluxos de entrada

  help                                Central de ajuda

  monitoring                          Logs, métricas e diagnóstico local

  demo                                Organização demonstrativa e
                                      manutenção isolada
  -----------------------------------------------------------------------

Cada módulo expõe contratos de aplicação. Compartilhamento de entidade
deve ser evitado; usar IDs e DTOs quando suficiente.
