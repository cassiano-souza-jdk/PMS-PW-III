# Arquitetura

## Estilo

Arquitetura híbrida: modular por funcionalidade, com camadas internas de
domínio, aplicação, infraestrutura e apresentação.

## Camadas

-   Domain: entidades, value objects, políticas e serviços puros.
-   Application: casos de uso, portas, DTOs e orquestração.
-   Infrastructure: Dexie, MSW, adapters, exportação, arquivos e
    serviços simulados.
-   Presentation: React, rotas, páginas, componentes e hooks.

## Regras de dependência

Presentation -\> Application -\> Domain. Infrastructure implementa
portas definidas por Application/Domain e é conectada por composição.
Domain não importa React, Dexie, MSW ou bibliotecas de UI.

## Organização

`src/app` para bootstrap, providers, rotas e layouts;
`src/modules/<module>` para módulos; `src/shared` para abstrações
genuinamente compartilhadas.

Cada módulo deve conter somente as camadas necessárias, sem criar
estrutura vazia artificial.

## Estado

Context API para Auth, Organization, Notification, Theme e Permission.
Dados de tarefas/projetos são obtidos por hooks de aplicação e serviços;
não colocar todo o banco em um contexto global.

## Eventos

Eventos são publicados após persistência confirmada. Eventos não
substituem transações ou autorização. Identificadores idempotentes
evitam duplicação.

## Composição

Uma raiz de composição instancia Dexie, repositórios, serviços, handlers
MSW e casos de uso e os disponibiliza à aplicação.

## Fronteiras

-   UI não acessa Dexie.
-   Casos de uso verificam permissões.
-   Repositórios filtram organizationId.
-   Serviços de domínio são puros sempre que possível.
-   MSW simula transporte, não implementa regras de negócio.
