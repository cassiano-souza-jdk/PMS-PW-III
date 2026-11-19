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
