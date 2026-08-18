import { FlowError } from './types.js';
const VAR_PATTERN = /\$\{([A-Za-z0-9_.]+)\}/g;
/** Replace `${VAR}` references. Unknown variables are an error, like Maestro. */
export function interpolate(value, vars) {
    return value.replace(VAR_PATTERN, (_, name) => {
        const resolved = vars[name];
        if (resolved === undefined) {
            throw new FlowError(`undefined variable \${${name}}`);
        }
        return resolved;
    });
}
/**
 * Deep-copy `value`, interpolating every string leaf. Steps are resolved
 * with this right before execution so runtime variables (e.g.
 * `maestro.copiedText`) are always fresh.
 */
export function deepInterpolate(value, vars) {
    if (typeof value === 'string') {
        return interpolate(value, vars);
    }
    if (Array.isArray(value)) {
        return value.map(item => deepInterpolate(item, vars));
    }
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [key, entry] of Object.entries(value)) {
            out[key] = deepInterpolate(entry, vars);
        }
        return out;
    }
    return value;
}
//# sourceMappingURL=interpolate.js.map