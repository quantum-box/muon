import type { Locator, Page } from '@playwright/test';
import { type SelectorSpec } from './types.js';
/**
 * `/foo/i` style strings become regular expressions; everything else is a
 * substring match (Playwright's default text matching).
 */
export declare function toTextMatch(value: string): string | RegExp;
/**
 * Resolve a selector spec to a Playwright locator. Like Maestro, when
 * several elements match, the first one is used unless `index` is given.
 */
export declare function resolveLocator(page: Page, spec: SelectorSpec): Locator;
/** Short human-readable form used in step titles and error messages. */
export declare function describeSelector(spec: SelectorSpec): string;
//# sourceMappingURL=selector.d.ts.map