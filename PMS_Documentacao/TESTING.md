# Estratégia de testes

## Ferramentas

Vitest, React Testing Library e Playwright.

## Pirâmide

-   Unitários: domínio, políticas, fórmulas, validação e casos de uso.
-   Integração: repositórios Dexie, transações, MSW e serviços.
-   Componentes: interação, acessibilidade e estados.
-   E2E: fluxos ponta a ponta por perfil e organização.

## Cenários críticos

-   Isolamento entre organizações, incluindo tentativas negativas.
-   Default Deny e Deny Overrides.
-   WIP e exceções.
-   Dependências cíclicas e pendentes.
-   Pausas e tempo efetivo.
-   Reaberturas e métricas por ciclo.
-   SLA, calendário, contestação e expiração.
-   Visibilidade de notas internas.
-   Exportação conforme permissões.
-   Backup, importação, rollback e restauração.
-   Lixeira e cascatas lógicas.
-   Atualização PWA e migração Dexie.

## Dados

Dados sintéticos determinísticos. IndexedDB isolado por execução.
Setup/teardown e execução paralela sem compartilhar estado.

## Critério

Não exigir somente cobertura percentual global. Exigir evidência de
regras críticas, caminhos negativos e integração. Playwright deve cobrir
os principais fluxos; não é necessário testar toda combinação possível.
