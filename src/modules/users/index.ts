export { normalizeEmail, type User } from './domain/user';
export type { UserRepositoryPort } from './application/ports/user-repository.port';
export {
  UserService,
  type UpdateMyProfileInput,
  type UserServiceDependencies,
} from './application/use-cases/user-service';
