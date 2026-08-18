/**
 * Maestro-style flow definitions.
 *
 * A flow file is a two-document YAML file: a config header followed by a
 * list of steps, mirroring Maestro's `appId` header + commands layout.
 */
export interface FlowConfig {
    /** URL opened by `launchApp`. Relative paths resolve against the Playwright baseURL. */
    url?: string;
    /** Test title. Defaults to the flow file name. */
    name?: string;
    /** Playwright test tags. `smoke` becomes `@smoke`. */
    tags?: string[];
    /** Flow-local environment variables, referenced as `${VAR}`. */
    env?: Record<string, string>;
    /** Register the flow with `test.skip`. */
    skip?: boolean;
    /** Register the flow with `test.only`. */
    only?: boolean;
}
/**
 * Element selector. Exactly one axis is used, chosen in this order:
 * css > id (data-testid) > role > label > placeholder > text.
 * Like Maestro, the first match wins unless `index` is given.
 */
export interface SelectorSpec {
    text?: string;
    /** Matches `data-testid`. */
    id?: string;
    css?: string;
    /** ARIA role, optionally combined with `name`. */
    role?: string;
    /** Accessible name, used together with `role`. */
    name?: string;
    label?: string;
    placeholder?: string;
    index?: number;
}
export interface StepBase {
    /** Ignore failures of this step and continue the flow. */
    optional?: boolean;
    /** Per-step timeout in milliseconds. */
    timeout?: number;
    /** Human-readable label shown in reports instead of the generated one. */
    label?: string;
}
export type Step = StepBase & ({
    type: 'launchApp';
    url?: string;
} | {
    type: 'openLink';
    url: string;
} | {
    type: 'back';
} | {
    type: 'tapOn';
    selector: SelectorSpec;
} | {
    type: 'doubleTapOn';
    selector: SelectorSpec;
} | {
    type: 'inputText';
    text: string;
    selector?: SelectorSpec;
} | {
    type: 'eraseText';
    characters?: number;
    selector?: SelectorSpec;
} | {
    type: 'pressKey';
    key: string;
} | {
    type: 'assertVisible';
    selector: SelectorSpec;
} | {
    type: 'assertNotVisible';
    selector: SelectorSpec;
} | {
    type: 'assertTitle';
    pattern: string;
} | {
    type: 'assertUrl';
    pattern: string;
} | {
    type: 'scroll';
    direction?: 'up' | 'down';
    amount?: number;
} | {
    type: 'scrollUntilVisible';
    selector: SelectorSpec;
} | {
    type: 'wait';
    ms: number;
} | {
    type: 'waitForAnimationToEnd';
} | {
    type: 'extendedWaitUntil';
    visible?: SelectorSpec;
    notVisible?: SelectorSpec;
} | {
    type: 'takeScreenshot';
    name?: string;
} | {
    type: 'evalScript';
    script: string;
} | {
    type: 'copyTextFrom';
    selector: SelectorSpec;
} | {
    type: 'pasteText';
} | {
    type: 'runFlow';
    file: string;
    env?: Record<string, string>;
} | {
    type: 'repeat';
    times: number;
    steps: Step[];
});
export type StepType = Step['type'];
export interface Flow {
    config: FlowConfig;
    steps: Step[];
    /** Absolute path of the flow file; `<inline>` for in-memory flows. */
    filePath: string;
}
export declare class FlowError extends Error {
    readonly filePath?: string | undefined;
    constructor(message: string, filePath?: string | undefined);
}
//# sourceMappingURL=types.d.ts.map