import { env as defaultEnv, type AppEnv } from '@/shared/config';
import {
  SimulationScenarioController,
  createHttpClient,
  type CreateHttpClientOptions,
  type HttpClient,
} from '@/shared/http';
import type { AttachmentBlobStorePort, IsoDateTime, TransactionPort } from '@/shared/kernel';
import { createLogger, type Logger } from '@/shared/logging';
import {
  DexieAttachmentBlobStore,
  DexieTransactionAdapter,
  PostCommitDomainEventBus,
  createPmsDatabase,
  type CreatePmsDatabaseOptions,
  type PmsDatabase,
} from '@/shared/persistence';
import { ensureDemoOrganizationSeeded, type DemoOrganizationSeedResult } from './demo-seed';
import { createRepositoriesRegistry, type AppRepositoriesRegistry } from './repositories-registry';

export interface AppCompositionContainer {
  readonly env: AppEnv;
  readonly logger: Logger;
  readonly db: PmsDatabase;
  readonly eventBus: PostCommitDomainEventBus;
  readonly transactionPort: TransactionPort;
  readonly attachmentBlobStore: AttachmentBlobStorePort;
  readonly repositories: AppRepositoriesRegistry;
  readonly simulationController: SimulationScenarioController;
  readonly httpClient: HttpClient;
  readonly seedDemoOrganization: (now?: IsoDateTime) => Promise<DemoOrganizationSeedResult>;
}

export interface CreateAppContainerOptions {
  readonly env?: AppEnv;
  readonly logger?: Logger;
  readonly db?: PmsDatabase;
  readonly dbOptions?: CreatePmsDatabaseOptions;
  readonly eventBus?: PostCommitDomainEventBus;
  readonly transactionPort?: TransactionPort;
  readonly attachmentBlobStore?: AttachmentBlobStorePort;
  readonly repositories?: AppRepositoriesRegistry;
  readonly simulationController?: SimulationScenarioController;
  readonly httpClient?: HttpClient;
  readonly httpClientOptions?: CreateHttpClientOptions;
}

export function createAppContainer(
  options: CreateAppContainerOptions = {},
): AppCompositionContainer {
  const resolvedEnv = options.env ?? defaultEnv;
  const resolvedLogger =
    options.logger ??
    createLogger({
      minLevel: resolvedEnv.VITE_LOG_LEVEL,
    });

  const resolvedDb = options.db ?? createPmsDatabase(options.dbOptions);
  const resolvedEventBus = options.eventBus ?? new PostCommitDomainEventBus();
  const resolvedTransactionPort =
    options.transactionPort ?? new DexieTransactionAdapter(resolvedDb, resolvedEventBus);
  const resolvedAttachmentBlobStore =
    options.attachmentBlobStore ?? new DexieAttachmentBlobStore(resolvedDb);
  const resolvedRepositories = options.repositories ?? createRepositoriesRegistry(resolvedDb);
  const resolvedSimulationController =
    options.simulationController ?? new SimulationScenarioController();
  const resolvedHttpClient = options.httpClient ?? createHttpClient(options.httpClientOptions);

  const seedDemoOrganization = (now?: IsoDateTime): Promise<DemoOrganizationSeedResult> =>
    ensureDemoOrganizationSeeded(
      {
        repositories: resolvedRepositories,
        transactionPort: resolvedTransactionPort,
        eventBus: resolvedEventBus,
      },
      now,
    );

  return Object.freeze({
    env: resolvedEnv,
    logger: resolvedLogger,
    db: resolvedDb,
    eventBus: resolvedEventBus,
    transactionPort: resolvedTransactionPort,
    attachmentBlobStore: resolvedAttachmentBlobStore,
    repositories: resolvedRepositories,
    simulationController: resolvedSimulationController,
    httpClient: resolvedHttpClient,
    seedDemoOrganization,
  });
}
