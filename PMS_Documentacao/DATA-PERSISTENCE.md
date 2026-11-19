# Persistência --- Dexie e IndexedDB

## Fonte de verdade

IndexedDB por meio de Dexie. Componentes React não acessam banco
diretamente.

## Requisitos

-   Schema versionado e migrações Dexie.
-   Índices por IDs, organizationId, projeto, estado e datas de
    consulta.
-   Transações em operações multi-entidade.
-   Repositórios implementam interfaces de aplicação.
-   Seeds determinísticas para demo.
-   Inicialização não sobrescreve dados existentes.
-   QuotaExceededError tratado com mensagem e diagnóstico.
-   Nunca apagar dados de negócio automaticamente.

## Armazenamento

Blobs de anexos em IndexedDB, metadados vinculados à entidade. Limite 15
MB por arquivo e 50 MB por tarefa/contexto aplicável. Formatos
permitidos conforme PRD.

## Backups

Backup automático diário, manter últimas 7 versões automáticas; manuais
preservados. Backup inclui metadados de versão, organização, integridade
e contagens. Restauração exige backup preventivo, validação, transação e
rollback.

## Importação

Formato JSON versionado. Preview, validação de IDs, versões,
relacionamentos, organização e integridade. Substituição/mesclagem
somente por fluxos explícitos. Nunca misturar organizações
implicitamente.

## Limitações

IndexedDB é local ao navegador/perfil; não é backup externo, não
sincroniza dispositivos e pode ser removido pelo usuário/navegador.
