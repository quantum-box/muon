export interface DefineWebFlowsOptions {
    /**
     * Directory containing `*.yaml` / `*.yml` flow files. Relative paths
     * resolve against the current working directory, so passing
     * `path.join(__dirname, 'flows')` is recommended.
     */
    dir: string;
    /** Extra variables available to every flow as `${VAR}`. */
    env?: Record<string, string>;
}
/**
 * Register every flow file under `dir` as a Playwright test. Call this from
 * a `*.spec.ts` file; each YAML flow becomes one `test()` and each step
 * shows up as a `test.step()` in reports and traces.
 */
export declare function defineWebFlows(options: DefineWebFlowsOptions): void;
//# sourceMappingURL=define-flows.d.ts.map