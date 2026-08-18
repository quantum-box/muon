import { FlowError } from './types.js';
// [\s\S] rather than the `s` flag: consumers may target below es2018.
const REGEX_PATTERN = /^\/([\s\S]+)\/([gimsuy]*)$/;
/**
 * `/foo/i` style strings become regular expressions; everything else is a
 * substring match (Playwright's default text matching).
 */
export function toTextMatch(value) {
    const match = REGEX_PATTERN.exec(value);
    if (match)
        return new RegExp(match[1], match[2]);
    return value;
}
/**
 * Resolve a selector spec to a Playwright locator. Like Maestro, when
 * several elements match, the first one is used unless `index` is given.
 */
export function resolveLocator(page, spec) {
    let locator;
    if (spec.css !== undefined) {
        locator = page.locator(spec.css);
    }
    else if (spec.id !== undefined) {
        locator = page.getByTestId(spec.id);
    }
    else if (spec.role !== undefined) {
        locator = page.getByRole(spec.role, spec.name !== undefined ? { name: toTextMatch(spec.name) } : undefined);
    }
    else if (spec.label !== undefined) {
        locator = page.getByLabel(toTextMatch(spec.label));
    }
    else if (spec.placeholder !== undefined) {
        locator = page.getByPlaceholder(toTextMatch(spec.placeholder));
    }
    else if (spec.text !== undefined) {
        locator = page.getByText(toTextMatch(spec.text));
    }
    else {
        throw new FlowError('selector has no matching axis');
    }
    return spec.index !== undefined ? locator.nth(spec.index) : locator.first();
}
/** Short human-readable form used in step titles and error messages. */
export function describeSelector(spec) {
    const parts = [];
    for (const key of [
        'text',
        'id',
        'css',
        'role',
        'name',
        'label',
        'placeholder',
    ]) {
        if (spec[key] !== undefined)
            parts.push(`${key}=${JSON.stringify(spec[key])}`);
    }
    if (spec.index !== undefined)
        parts.push(`index=${spec.index}`);
    return parts.join(' ');
}
//# sourceMappingURL=selector.js.map