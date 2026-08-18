import { type Flow } from './types.js';
/** Read and parse a single flow file. */
export declare function loadFlowFile(filePath: string): Flow;
/**
 * Collect flow files under `dir` (recursively), sorted by path. Files and
 * directories starting with `_` are treated as subflows / shared fragments
 * and are not registered as tests.
 */
export declare function collectFlowFiles(dir: string): string[];
//# sourceMappingURL=files.d.ts.map