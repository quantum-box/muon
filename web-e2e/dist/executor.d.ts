import type { Page } from '@playwright/test';
import { type Flow, type Step } from './types.js';
/** Variable holding the last `copyTextFrom` result, like Maestro. */
export declare const COPIED_TEXT_VAR = "maestro.copiedText";
export interface RunFlowOptions {
    page: Page;
    /** Extra variables, highest precedence below runtime-produced ones. */
    env?: Record<string, string>;
    /** Receives screenshots; wired to `testInfo.attach` by `defineWebFlows`. */
    attach?: (name: string, body: Buffer, contentType: string) => Promise<void>;
    /** Wraps each step; wired to `test.step` by `defineWebFlows`. */
    wrapStep?: (title: string, body: () => Promise<void>) => Promise<void>;
    /** Called when an `optional: true` step fails. */
    log?: (message: string) => void;
}
/** Execute a parsed flow against a Playwright page. */
export declare function runFlow(flow: Flow, options: RunFlowOptions): Promise<void>;
/** Step title for reports and error messages. */
export declare function describeStep(step: Step): string;
//# sourceMappingURL=executor.d.ts.map