import type { AppErrorCode } from '@/shared/errors';
import { httpStatusToAppErrorCode, type HttpMethod } from './http-types';

export interface SimulationScenarioRule {
  readonly method?: HttpMethod | '*';
  readonly pathPattern: string;
  readonly latencyMs?: number;
  readonly forceStatus?: number;
  readonly forceErrorCode?: AppErrorCode;
  readonly forceErrorMessage?: string;
  readonly networkError?: boolean;
  readonly remainingApplications?: number;
}

export interface ResolvedSimulationOutcome {
  readonly latencyMs: number;
  readonly networkError: boolean;
  readonly forcedError?: {
    readonly status: number;
    readonly code: AppErrorCode;
    readonly message: string;
  };
}

interface InternalRuleState {
  readonly method: HttpMethod | '*';
  readonly pathPattern: string;
  readonly latencyMs?: number;
  readonly forceStatus?: number;
  readonly forceErrorCode?: AppErrorCode;
  readonly forceErrorMessage?: string;
  readonly networkError?: boolean;
  remainingApplications?: number;
}

function normalizePath(path: string): string {
  try {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return new URL(path).pathname;
    }
  } catch {
    // Fallback to raw path below
  }

  const queryIndex = path.indexOf('?');
  return queryIndex >= 0 ? path.slice(0, queryIndex) : path;
}

function doesPathMatchPattern(pathname: string, pattern: string): boolean {
  const normalizedPathname = normalizePath(pathname);
  const normalizedPattern = normalizePath(pattern);

  if (normalizedPattern === '*' || normalizedPathname === normalizedPattern) {
    return true;
  }

  if (normalizedPattern.endsWith('*')) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedPathname.startsWith(prefix);
  }

  const patternSegments = normalizedPattern.split('/').filter(Boolean);
  const pathSegments = normalizedPathname.split('/').filter(Boolean);

  if (patternSegments.length !== pathSegments.length) {
    return false;
  }

  return patternSegments.every((segment, index) => {
    if (segment.startsWith(':')) {
      return (pathSegments[index] ?? '').length > 0;
    }
    return segment === pathSegments[index];
  });
}

/**
 * Deterministic controller for MSW latency and failure simulation scenarios (API-SIMULATION.md, ADR-0007 §5.1).
 */
export class SimulationScenarioController {
  private defaultLatencyMs = 0;
  private readonly rules: InternalRuleState[] = [];

  setDefaultLatencyMs(latencyMs: number): void {
    this.defaultLatencyMs = Math.max(0, Math.floor(latencyMs));
  }

  getDefaultLatencyMs(): number {
    return this.defaultLatencyMs;
  }

  setRule(rule: SimulationScenarioRule): void {
    const normalizedMethod: HttpMethod | '*' = rule.method ?? '*';
    const existingIndex = this.rules.findIndex(
      (item) => item.method === normalizedMethod && item.pathPattern === rule.pathPattern,
    );

    const internalState: InternalRuleState = {
      method: normalizedMethod,
      pathPattern: rule.pathPattern,
      ...(rule.latencyMs !== undefined
        ? { latencyMs: Math.max(0, Math.floor(rule.latencyMs)) }
        : {}),
      ...(rule.forceStatus !== undefined ? { forceStatus: rule.forceStatus } : {}),
      ...(rule.forceErrorCode !== undefined ? { forceErrorCode: rule.forceErrorCode } : {}),
      ...(rule.forceErrorMessage !== undefined
        ? { forceErrorMessage: rule.forceErrorMessage }
        : {}),
      ...(rule.networkError !== undefined ? { networkError: rule.networkError } : {}),
      ...(rule.remainingApplications !== undefined
        ? { remainingApplications: Math.max(1, Math.floor(rule.remainingApplications)) }
        : {}),
    };

    if (existingIndex >= 0) {
      this.rules[existingIndex] = internalState;
    } else {
      this.rules.push(internalState);
    }
  }

  clearRules(): void {
    this.rules.length = 0;
    this.defaultLatencyMs = 0;
  }

  getRules(): readonly SimulationScenarioRule[] {
    return Object.freeze(this.rules.map((rule) => Object.freeze({ ...rule })));
  }

  matchRule(method: string, urlOrPath: string): ResolvedSimulationOutcome {
    const upperMethod = method.toUpperCase() as HttpMethod;
    const pathname = normalizePath(urlOrPath);

    for (let index = 0; index < this.rules.length; index += 1) {
      const rule = this.rules[index];
      if (!rule) {
        continue;
      }

      const methodMatches = rule.method === '*' || rule.method === upperMethod;
      if (!methodMatches || !doesPathMatchPattern(pathname, rule.pathPattern)) {
        continue;
      }

      if (rule.remainingApplications !== undefined) {
        rule.remainingApplications -= 1;
        if (rule.remainingApplications <= 0) {
          this.rules.splice(index, 1);
        }
      }

      const latencyMs = rule.latencyMs ?? this.defaultLatencyMs;
      if (rule.networkError === true) {
        return Object.freeze({
          latencyMs,
          networkError: true,
        });
      }

      if (rule.forceStatus !== undefined || rule.forceErrorCode !== undefined) {
        const status = rule.forceStatus ?? 500;
        const code = rule.forceErrorCode ?? httpStatusToAppErrorCode(status);
        const message =
          rule.forceErrorMessage ??
          `Simulated HTTP ${status} error (${code}) for ${upperMethod} ${pathname}.`;

        return Object.freeze({
          latencyMs,
          networkError: false,
          forcedError: Object.freeze({
            status,
            code,
            message,
          }),
        });
      }

      return Object.freeze({
        latencyMs,
        networkError: false,
      });
    }

    return Object.freeze({
      latencyMs: this.defaultLatencyMs,
      networkError: false,
    });
  }
}
