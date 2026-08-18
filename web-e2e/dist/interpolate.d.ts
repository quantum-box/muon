/** Replace `${VAR}` references. Unknown variables are an error, like Maestro. */
export declare function interpolate(value: string, vars: Record<string, string | undefined>): string;
/**
 * Deep-copy `value`, interpolating every string leaf. Steps are resolved
 * with this right before execution so runtime variables (e.g.
 * `maestro.copiedText`) are always fresh.
 */
export declare function deepInterpolate<T>(value: T, vars: Record<string, string | undefined>): T;
//# sourceMappingURL=interpolate.d.ts.map