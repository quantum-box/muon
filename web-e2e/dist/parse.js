import { loadAll } from 'js-yaml';
import { FlowError, } from './types.js';
const SELECTOR_KEYS = [
    'text',
    'id',
    'css',
    'role',
    'name',
    'label',
    'placeholder',
    'index',
];
const STEP_BASE_KEYS = ['optional', 'timeout', 'label'];
/** Commands that may appear as a bare string (no arguments). */
const BARE_COMMANDS = new Set([
    'launchApp',
    'back',
    'scroll',
    'waitForAnimationToEnd',
    'pasteText',
    'eraseText',
]);
/** Parse the two-document YAML source of a flow file. */
export function parseFlow(source, filePath = '<inline>') {
    const docs = loadAll(source).filter(doc => doc !== null && doc !== undefined);
    let rawConfig = {};
    let rawSteps;
    if (docs.length === 1) {
        rawSteps = docs[0];
    }
    else if (docs.length === 2) {
        ;
        [rawConfig, rawSteps] = docs;
    }
    else {
        throw new FlowError(`expected a config header and a step list (got ${docs.length} YAML documents)`, filePath);
    }
    const config = parseConfig(rawConfig, filePath);
    if (!Array.isArray(rawSteps)) {
        throw new FlowError('flow steps must be a YAML list', filePath);
    }
    const steps = rawSteps.map((raw, index) => normalizeStep(raw, `steps[${index}]`, filePath));
    return { config, steps, filePath };
}
function parseConfig(raw, filePath) {
    const obj = expectObject(raw, 'config header', filePath);
    const config = {};
    for (const [key, value] of Object.entries(obj)) {
        switch (key) {
            case 'url':
            case 'name':
                config[key] = expectString(value, `config.${key}`, filePath);
                break;
            case 'tags':
                if (!Array.isArray(value) ||
                    value.some(tag => typeof tag !== 'string')) {
                    throw new FlowError('config.tags must be a list of strings', filePath);
                }
                config.tags = value;
                break;
            case 'env':
                config.env = expectStringRecord(value, 'config.env', filePath);
                break;
            case 'skip':
            case 'only':
                config[key] = expectBoolean(value, `config.${key}`, filePath);
                break;
            // Tolerated for Maestro compatibility; the web runner has no appId.
            case 'appId':
                break;
            default:
                throw new FlowError(`unknown config key "${key}"`, filePath);
        }
    }
    return config;
}
function normalizeStep(raw, path, filePath) {
    if (typeof raw === 'string') {
        if (!BARE_COMMANDS.has(raw)) {
            throw new FlowError(`${path}: "${raw}" is not a known bare command`, filePath);
        }
        return { type: raw };
    }
    const obj = expectObject(raw, path, filePath);
    const keys = Object.keys(obj);
    if (keys.length !== 1) {
        throw new FlowError(`${path}: a step must have exactly one command key (got: ${keys.join(', ') || 'none'})`, filePath);
    }
    const command = keys[0];
    const value = obj[command];
    const at = `${path}.${command}`;
    switch (command) {
        case 'launchApp': {
            if (value === null)
                return { type: 'launchApp' };
            const params = expectObject(value, at, filePath);
            return withBase({
                type: 'launchApp',
                url: optionalString(params.url, `${at}.url`, filePath),
            }, params, at, filePath, ['url']);
        }
        case 'openLink': {
            if (typeof value === 'string')
                return { type: 'openLink', url: value };
            const params = expectObject(value, at, filePath);
            return withBase({
                type: 'openLink',
                url: expectString(params.link ?? params.url, `${at}.url`, filePath),
            }, params, at, filePath, ['link', 'url']);
        }
        case 'back':
            expectNoParams(value, at, filePath);
            return { type: 'back' };
        case 'tapOn':
        case 'doubleTapOn':
        case 'assertVisible':
        case 'assertNotVisible':
        case 'scrollUntilVisible':
        case 'copyTextFrom': {
            const { selector, rest } = splitSelector(value, at, filePath);
            if (!selector) {
                throw new FlowError(`${at} requires a selector`, filePath);
            }
            return withBase({ type: command, selector }, rest, at, filePath, []);
        }
        case 'inputText': {
            if (typeof value === 'string')
                return { type: 'inputText', text: value };
            const params = expectObject(value, at, filePath);
            const text = expectString(params.text, `${at}.text`, filePath);
            const { selector } = splitSelector(omit(params, ['text', ...STEP_BASE_KEYS]), at, filePath, { allowEmpty: true });
            return withBase({ type: 'inputText', text, selector }, params, at, filePath, ['text', ...SELECTOR_KEYS]);
        }
        case 'eraseText': {
            if (value === null)
                return { type: 'eraseText' };
            if (typeof value === 'number') {
                return { type: 'eraseText', characters: value };
            }
            const params = expectObject(value, at, filePath);
            const { selector } = splitSelector(omit(params, ['characters', ...STEP_BASE_KEYS]), at, filePath, { allowEmpty: true });
            return withBase({
                type: 'eraseText',
                characters: optionalNumber(params.characters, `${at}.characters`, filePath),
                selector,
            }, params, at, filePath, ['characters', ...SELECTOR_KEYS]);
        }
        case 'pressKey':
            return { type: 'pressKey', key: expectString(value, at, filePath) };
        case 'assertTitle':
        case 'assertUrl':
            return {
                type: command,
                pattern: expectString(value, at, filePath),
            };
        case 'scroll': {
            if (value === null)
                return { type: 'scroll' };
            const params = expectObject(value, at, filePath);
            const direction = optionalString(params.direction, `${at}.direction`, filePath);
            if (direction !== undefined &&
                direction !== 'up' &&
                direction !== 'down') {
                throw new FlowError(`${at}.direction must be "up" or "down"`, filePath);
            }
            return withBase({
                type: 'scroll',
                direction: direction,
                amount: optionalNumber(params.amount, `${at}.amount`, filePath),
            }, params, at, filePath, ['direction', 'amount']);
        }
        case 'wait':
            return { type: 'wait', ms: expectNumber(value, at, filePath) };
        case 'waitForAnimationToEnd': {
            if (value === null)
                return { type: 'waitForAnimationToEnd' };
            const params = expectObject(value, at, filePath);
            return withBase({ type: 'waitForAnimationToEnd' }, params, at, filePath, []);
        }
        case 'extendedWaitUntil': {
            const params = expectObject(value, at, filePath);
            const visible = params.visible === undefined
                ? undefined
                : normalizeSelector(params.visible, `${at}.visible`, filePath);
            const notVisible = params.notVisible === undefined
                ? undefined
                : normalizeSelector(params.notVisible, `${at}.notVisible`, filePath);
            if (!visible && !notVisible) {
                throw new FlowError(`${at} requires "visible" and/or "notVisible"`, filePath);
            }
            return withBase({ type: 'extendedWaitUntil', visible, notVisible }, params, at, filePath, ['visible', 'notVisible']);
        }
        case 'takeScreenshot': {
            if (typeof value === 'string')
                return { type: 'takeScreenshot', name: value };
            if (value === null)
                return { type: 'takeScreenshot' };
            const params = expectObject(value, at, filePath);
            return withBase({
                type: 'takeScreenshot',
                name: optionalString(params.name, `${at}.name`, filePath),
            }, params, at, filePath, ['name']);
        }
        case 'evalScript':
            return { type: 'evalScript', script: expectString(value, at, filePath) };
        case 'pasteText':
            expectNoParams(value, at, filePath);
            return { type: 'pasteText' };
        case 'runFlow': {
            if (typeof value === 'string')
                return { type: 'runFlow', file: value };
            const params = expectObject(value, at, filePath);
            return withBase({
                type: 'runFlow',
                file: expectString(params.file, `${at}.file`, filePath),
                env: params.env === undefined
                    ? undefined
                    : expectStringRecord(params.env, `${at}.env`, filePath),
            }, params, at, filePath, ['file', 'env']);
        }
        case 'repeat': {
            const params = expectObject(value, at, filePath);
            const rawCommands = params.commands ?? params.steps;
            if (!Array.isArray(rawCommands)) {
                throw new FlowError(`${at}.commands must be a YAML list`, filePath);
            }
            return withBase({
                type: 'repeat',
                times: expectNumber(params.times, `${at}.times`, filePath),
                steps: rawCommands.map((step, index) => normalizeStep(step, `${at}.commands[${index}]`, filePath)),
            }, params, at, filePath, ['times', 'commands', 'steps']);
        }
        default:
            throw new FlowError(`${path}: unknown command "${command}"`, filePath);
    }
}
/** Extract selector keys from a shorthand string or params object. */
function splitSelector(value, at, filePath, options = {}) {
    if (typeof value === 'string') {
        return { selector: { text: value }, rest: {} };
    }
    const params = expectObject(value, at, filePath);
    const selector = normalizeSelector(params, at, filePath, options);
    return { selector, rest: params };
}
function normalizeSelector(value, at, filePath, options = {}) {
    if (typeof value === 'string')
        return { text: value };
    const params = expectObject(value, at, filePath);
    const selector = {};
    for (const key of SELECTOR_KEYS) {
        const entry = params[key];
        if (entry === undefined)
            continue;
        if (key === 'index') {
            selector.index = expectNumber(entry, `${at}.index`, filePath);
        }
        else {
            selector[key] = expectString(entry, `${at}.${key}`, filePath);
        }
    }
    const unknown = Object.keys(params).filter(key => !SELECTOR_KEYS.includes(key) &&
        !STEP_BASE_KEYS.includes(key));
    if (unknown.length > 0) {
        throw new FlowError(`${at}: unknown selector key(s): ${unknown.join(', ')}`, filePath);
    }
    const hasAxis = SELECTOR_KEYS.some(key => key !== 'index' && selector[key] !== undefined);
    if (!hasAxis) {
        if (options.allowEmpty)
            return undefined;
        throw new FlowError(`${at}: a selector needs one of ${SELECTOR_KEYS.filter(k => k !== 'index').join(', ')}`, filePath);
    }
    return selector;
}
/** Merge shared step params (optional/timeout/label) into a normalized step. */
function withBase(step, params, at, filePath, knownKeys) {
    const base = {};
    if (params.optional !== undefined) {
        base.optional = expectBoolean(params.optional, `${at}.optional`, filePath);
    }
    if (params.timeout !== undefined) {
        base.timeout = expectNumber(params.timeout, `${at}.timeout`, filePath);
    }
    if (params.label !== undefined) {
        base.label = expectString(params.label, `${at}.label`, filePath);
    }
    const allowed = new Set([...knownKeys, ...STEP_BASE_KEYS, ...SELECTOR_KEYS]);
    // Selector-less commands still validate unknown keys via their own lists;
    // selector commands validated inside normalizeSelector.
    for (const key of Object.keys(params)) {
        if (!allowed.has(key)) {
            throw new FlowError(`${at}: unknown key "${key}"`, filePath);
        }
    }
    return { ...step, ...base };
}
function omit(obj, keys) {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (!keys.includes(key))
            out[key] = value;
    }
    return out;
}
function expectObject(value, at, filePath) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new FlowError(`${at} must be a YAML mapping`, filePath);
    }
    return value;
}
function expectString(value, at, filePath) {
    if (typeof value !== 'string') {
        throw new FlowError(`${at} must be a string`, filePath);
    }
    return value;
}
function optionalString(value, at, filePath) {
    return value === undefined ? undefined : expectString(value, at, filePath);
}
function expectNumber(value, at, filePath) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new FlowError(`${at} must be a number`, filePath);
    }
    return value;
}
function optionalNumber(value, at, filePath) {
    return value === undefined ? undefined : expectNumber(value, at, filePath);
}
function expectBoolean(value, at, filePath) {
    if (typeof value !== 'boolean') {
        throw new FlowError(`${at} must be a boolean`, filePath);
    }
    return value;
}
function expectStringRecord(value, at, filePath) {
    const obj = expectObject(value, at, filePath);
    const out = {};
    for (const [key, entry] of Object.entries(obj)) {
        out[key] = String(entry);
    }
    return out;
}
function expectNoParams(value, at, filePath) {
    if (value !== null && value !== undefined) {
        throw new FlowError(`${at} takes no parameters`, filePath);
    }
}
//# sourceMappingURL=parse.js.map