export {
  IMPEDIMENT_CATEGORIES,
  IMPEDIMENT_STATUSES,
  assertImpedimentTransitionAllowed,
  isImpedimentBlocking,
  type Impediment,
  type ImpedimentCategory,
  type ImpedimentStatus,
  type ImpedimentTransitionResult,
} from './domain/impediment';
export type { ImpedimentRepositoryPort } from './application/ports/impediment-repository.port';
export type {
  ImpedimentActorProjectScopes,
  ImpedimentProjectSummary,
  ImpedimentTaskSummary,
  ImpedimentWorkContextPort,
  SyncTaskAfterImpedimentInput,
} from './application/ports/impediment-work-context.port';
export {
  ImpedimentService,
  type CreateImpedimentInput,
  type ImpedimentServiceDependencies,
  type TransitionImpedimentInput,
  type UpdateImpedimentInput,
} from './application/services/impediment-service';
