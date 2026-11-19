# Segurança e limitações

## Controles do protótipo

RBAC + ABAC local, validação Zod, autorização em casos de uso,
sanitização, CSP compatível, tratamento de arquivos, sessão simulada e
minimização de dados em logs.

## Limitações explícitas

-   Usuário controla navegador e armazenamento local.
-   IndexedDB pode ser inspecionado/modificado.
-   MSW não é servidor.
-   Tokens/sessões são simulados.
-   Não há proteção real de backend.
-   Não há segredo que possa ser protegido em código frontend.
-   CSP reduz riscos, mas não substitui backend seguro.

## Evolução para produção real

Backend deverá validar identidade e autorização no servidor, controlar
organização e permissões, usar armazenamento remoto, gestão segura de
sessão (preferencialmente cookies HttpOnly/Secure/SameSite), rate
limiting, validação de arquivos, logs centralizados e controles de
segurança adequados.
