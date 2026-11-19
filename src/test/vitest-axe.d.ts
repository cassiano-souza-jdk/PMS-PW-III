import type { NoViolationsMatcherResult } from 'vitest-axe/matchers';

declare module 'vitest' {
  interface Assertion<T> {
    toHaveNoViolations(this: Assertion<T>): NoViolationsMatcherResult;
  }

  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): NoViolationsMatcherResult;
  }
}
