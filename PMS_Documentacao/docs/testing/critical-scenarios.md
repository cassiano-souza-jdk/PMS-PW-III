# Cenários críticos de validação

1.  Usuário de organização A tenta ler registro da organização B.
2.  MEMBER tenta configurar quadro.
3.  MANAGER tenta decidir contestação.
4.  Tarefa excede WIP sem exceção.
5.  Dependência cria ciclo.
6.  Tarefa é concluída com dependência pendente.
7.  Pausa é aberta e encerrada; tempo efetivo confere.
8.  Feedback aguarda contestação e não encerra enquanto há contestação
    pendente.
9.  Contestação é decidida e encerra automaticamente.
10. Reabertura excepcional cria novo ciclo com novos SLAs.
11. Autor não visualiza nota interna.
12. Exportação exclui dados fora do escopo.
13. Importação inválida realiza rollback.
14. Restauração não altera outras organizações.
15. Migração Dexie preserva dados.
16. Atualização PWA não interrompe operação crítica.
