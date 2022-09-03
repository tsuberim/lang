import { Pattern, walkExpr } from "./expr";
import { mapValues, Context, isUppercase } from "./utils";
import chalk from 'chalk';
import { TRec } from "./type";

const _tagSymbol = Symbol('tag');

export type VUnit = null;
export type VNum = number;
export type VStr = string;
export type VLst = Value[]
export type VRec = { [key: string]: Value };
export type VTag = { [_tagSymbol]: string, value?: Value };
export type VClo = ((...vals: Value[]) => Value)
export type Value = VUnit | VNum | VStr | VTag | VLst | VRec | VClo;

export function tagName(tag: VTag) {
    return tag[_tagSymbol];
}

export function tag(name: string, value?: Value): VTag {
    return { [_tagSymbol]: name, value };
}

export function isTag(value: Value): value is VTag {
    return typeof value === 'object' && !Array.isArray(value) && (value as any)[_tagSymbol]
}

export function isRec(value: Value): value is VRec {
    return typeof value === 'object' && !Array.isArray(value) && !(value as any)[_tagSymbol]
}

export interface ValueWalker<T> {
    void: (v: VUnit) => T,
    num: (v: VNum) => T;
    str: (v: VStr) => T;
    lst: (v: VLst, values: T[]) => T,
    rec: (v: VRec, rec: { [key: string]: T }) => T;
    tag: (v: VTag, value?: T) => T;
    clo: (v: VClo) => T;
}

export function walkValue<T>(walker: ValueWalker<T>) {
    const f = (val: Value): T => {
        if (typeof val === 'number') {
            return walker.num(val);
        } if (val === null) {
            return walker.void(val);
        } else if (typeof val === 'string') {
            return walker.str(val)
        } else if (typeof val === 'object' && !Array.isArray(val)) {
            if ((val as any)[_tagSymbol]) {
                const v = val as VTag;
                return walker.tag(v, v.value ? f(v.value) : undefined)
            } else {
                return walker.rec(val, mapValues(val, f))
            }
        } else if (Array.isArray(val)) {
            return walker.lst(val, val.map(f))
        } else if (typeof val === 'function') {
            return walker.clo(val);
        } else {
            throw new RuntimeError(`Impossible`)
        }
    };
    return f;
}

export const formatValue = walkValue({
    void: _ => '',
    num: n => chalk.yellow(n.toString()),
    str: str => chalk.blueBright(`'` + str + `'`),
    lst: (_, vals) => chalk`{cyan [} ${vals.join(', ')} {cyan ]}`,
    rec: (_, rec) => chalk.cyan('{ ') + Object.entries(rec).map(([name, value]) => chalk.cyan(name) + chalk.cyan(': ') + value).join(', ') + chalk.cyan(' }'),
    tag: ({ [_tagSymbol]: name }, value) => value ? chalk`${name}(${value})` : name,
    clo: f => chalk.magenta(`<closure>`)
});

export class RuntimeError extends Error {
    constructor(msg: string) {
        super('RuntimeError: ' + msg)
    }
}

export function match(ptn: Pattern, value: Value): Context<Value> {
    if (value === null) {
        throw new RuntimeError(`Impossible match on void`)
    } else if (ptn.type === 'lit') {
        if (ptn.value === value) {
            return {}
        } else {
            throw new RuntimeError(`${ptn.value} != ${formatValue(value)}`)
        }
    } else if (ptn.type === 'id') {
        return { [ptn.name]: value };
    } else if (ptn.type === 'patlist') {
        if (Array.isArray(value) && value.length === ptn.values.length) {
            const substs = ptn.values.map((p, i) => match(p, value[i]));
            const out = {};
            for (const s of substs) {
                Object.assign(out, s)
            };
            return out;
        } else {
            throw new RuntimeError(`Expected a list, got ${formatValue(value)}`)
        }
    } else if (ptn.type === 'patrec') {
        if (isRec(value)) {
            const rec = value as VRec;
            const substs = Object.entries(ptn.record).map(([k, p]) => match(p, rec[k]));
            const out = {};
            for (const s of substs) {
                Object.assign(out, s)
            };
            return out;
        } else {
            throw new RuntimeError(`Expected a record, got ${formatValue(value)}`)
        }
    } else {
        throw new RuntimeError(`Impossible`)
    }
}

export const eq = walkValue<(other: Value) => boolean>({
    void: (v: VUnit) => other => false,
    num: (v: VNum) => other => other === v,
    str: (v: VStr) => other => other === v,
    lst: (v: VLst, values) => other => Array.isArray(other) && other.length === v.length && values.every((v, i) => v(other[i])),
    rec: (v: VRec, rec) => other => isRec(other) && Object.keys(other).length === Object.keys(rec).length && Object.values(mapValues(rec, (v, k) => v((other as VRec)[k]))).every(x => x),
    tag: (v: VTag, value) => other => isTag(other) && tagName(other) === tagName(v) && !!value === !!other.value && (!value || value(other.value!)),
    clo: (v: VClo) => other => false,
})

export const evaluate = walkExpr<(ctx: Context<Value>) => Value>({
    lit: ({ value }) => _ => value,
    list: (_, values) => ctx => values.map(val => val(ctx)),
    rec: (_, record) => ctx => mapValues(record, v => v(ctx)),
    id: ({ name }) => ctx => {
        if (ctx[name]) {
            return ctx[name]
        } {
            throw new RuntimeError(`Unbound variable ${ctx[name]}`)
        }
    },
    cons: ({ name }, value) => ctx => ({ [_tagSymbol]: name, value: value && value(ctx) } as VTag),
    match: (_, value, cases, otherwise) => ctx => {
        const val = value(ctx);
        if (isTag(val)) {
            const name = tagName(val);
            for (const [ptn, v] of cases) {
                if (ptn.name === name && !!val.value === !!ptn.value) {
                    try {
                        const subst = val.value ? match(ptn.value!, val.value!) : {};
                        return v({ ...ctx, ...subst })
                    } catch (e) { }
                }
            }
            if (otherwise) {
                return otherwise(ctx);
            } else {
                throw new RuntimeError(`No case matched`)
            }
        } else {
            throw new RuntimeError(`Expected a tag, found ${formatValue(val)}`)
        }
    },
    acc: (e, rec) => ctx => {
        const val = rec(ctx);
        if (isRec(val)) {
            return (val as VRec)[e.prop];
        } else {
            throw new RuntimeError(`Cannot access property ${e.prop} of ${formatValue(val)}`);
        }
    },
    app: (_, fn, args) => ctx => (fn(ctx) as Function)(...args.map(arg => arg(ctx))),
    lam: ({ args }, body) => ctx => (...vals: any[]) => body({ ...ctx, ...Object.fromEntries(args.map((arg, i) => [arg.name, vals[i]])) })
})
