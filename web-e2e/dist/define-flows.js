import path from 'node:path';
import { test } from '@playwright/test';
import { runFlow } from './executor.js';
import { collectFlowFiles, loadFlowFile } from './files.js';
import { FlowError } from './types.js';
/**
 * Register every flow file under `dir` as a Playwright test. Call this from
 * a `*.spec.ts` file; each YAML flow becomes one `test()` and each step
 * shows up as a `test.step()` in reports and traces.
 */
export function defineWebFlows(options) {
    const dir = path.resolve(options.dir);
    const files = collectFlowFiles(dir);
    if (files.length === 0) {
        throw new FlowError('no flow files (*.yaml / *.yml) found', dir);
    }
    for (const filePath of files) {
        const flow = loadFlowFile(filePath);
        const title = flow.config.name ?? path.relative(dir, filePath);
        const tags = (flow.config.tags ?? []).map(tag => tag.startsWith('@') ? tag : `@${tag}`);
        const register = flow.config.only
            ? test.only
            : flow.config.skip
                ? test.skip
                : test;
        register(title, { tag: tags }, async ({ page }, testInfo) => {
            await runFlow(flow, {
                page,
                env: options.env,
                attach: (name, body, contentType) => testInfo.attach(name, { body, contentType }),
                wrapStep: (stepTitle, body) => test.step(stepTitle, body),
                log: message => console.warn(`[muon-web-e2e] ${message}`),
            });
        });
    }
}
//# sourceMappingURL=define-flows.js.map