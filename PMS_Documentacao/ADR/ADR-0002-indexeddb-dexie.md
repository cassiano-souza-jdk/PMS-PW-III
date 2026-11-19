# ADR-0002 --- Persistência local com IndexedDB/Dexie

-   Status: Aceita
-   Contexto: protótipo deve persistir dados no navegador sem backend.
-   Decisão: IndexedDB como fonte persistente, Dexie como abstração.
-   Consequências: persistência local e assíncrona; sem sincronização
    multi-dispositivo; migrações e backups são responsabilidade da
    aplicação.
