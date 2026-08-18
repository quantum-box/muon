/**
 * Maestro-style flow definitions.
 *
 * A flow file is a two-document YAML file: a config header followed by a
 * list of steps, mirroring Maestro's `appId` header + commands layout.
 */
export class FlowError extends Error {
    filePath;
    constructor(message, filePath) {
        super(filePath ? `${message} (${filePath})` : message);
        this.filePath = filePath;
        this.name = 'FlowError';
    }
}
//# sourceMappingURL=types.js.map