import { Pattern, walkExpr } from "./expr";
import { mapValues, Context, isUppercase } from "./utils";
import chalk from 'chalk';

const _tagSymbol = Symbol('tag');

export type VNum = number;
export type VStr = string;
export type VLst = Value[]
export type VRec = { [key: string]: Value };
export type VTag = { [_tagSymbol]: string, value?: Value };
export type VClo = ((...vals: Value[]) => Value)
export type Value = VNum | VStr | VLst | VRec | VClo;

export interface ValueWalker<T> {
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
            throw new Error(`Impossible`)
        }
    };
    return f;
}

export const formatValue = walkValue({
    num: n => chalk.yellow(n.toString()),
    str: str => chalk.blueBright(`'` + str + `'`),
    lst: (_, vals) => chalk`{cyan [} ${vals.join(', ')} {cyan ]}`,
    rec: (_, rec) => chalk.cyan('{ ') + Object.entries(rec).map(([name, value]) => chalk.cyan(name) + chalk.cyan(': ') + value).join(', ') + chalk.cyan(' }'),
    tag: ({ [_tagSymbol]: name }, value) => value ? chalk`${name}(${value})` : name,
    clo: f => chalk.magenta(`<closure>`)
});

export function match(ptn: Pattern, value: Value): Context<Value> {
    if (ptn.type === 'lit') {
        if (ptn.value === value) {
            return {}
        } else {
            throw Error(`${ptn.value} != ${formatValue(value)}`)
        }
    } else if (ptn.type === 'id') {
        return { [ptn.name]: value };
    } else if (ptn.type === 'patcons') {
        const consMatch = typeof value === 'object' && (value as any)[_tagSymbol] === ptn.name;
        if (consMatch) {
            const val = value as VTag;
            if (!!val.value === !!ptn.value) {
                return (!ptn.value && {}) || match(ptn.value!, val.value!);
            } else {
                throw new Error('TODO');
            }
        } else {
            throw new Error(`${formatValue(value)} is not a tag of name ${ptn.name}`)
        }
    } else if (ptn.type === 'patlist') {
        if (Array.isArray(value)) {
            const substs = ptn.values.map((p, i) => match(p, value[i]));
            const out = {};
            for (const s of substs) {
                Object.assign(out, s)
            };
            return out;
        } else {
            throw new Error(`Expected a list, got ${formatValue(value)}`)
        }
    } else if (ptn.type === 'patrec') {
        if (typeof value === 'object' && !Array.isArray(value)) {
            const substs = Object.entries(ptn.record).map(([k, p]) => match(p, value[k]));
            const out = {};
            for (const s of substs) {
                Object.assign(out, s)
            };
            return out;
        } else {
            throw new Error(`Expected a record, got ${formatValue(value)}`)
        }
    } else {
        throw new Error(`Impossible`)
    }
}

export const evaluate = walkExpr<(ctx: Context<Value>) => Value>({
    lit: ({ value }) => _ => value,
    list: (_, values) => ctx => values.map(val => val(ctx)),
    rec: (_, record) => ctx => mapValues(record, v => v(ctx)),
    id: ({ name }) => ctx => isUppercase(name) ? (value: Value) => ({ [_tagSymbol]: name, value }) : ctx[name],
    cons: ({ name }, value) => ctx => ({ [_tagSymbol]: name, value: value && value(ctx) } as VTag),
    match: (_, value, cases) => ctx => {
        const val = value(ctx);
        for (const [ptn, v] of cases) {
            try {
                const subst = match(ptn, val);
                return v({ ...ctx, ...subst })
            } catch (e) { }
        }
        throw new Error(`No case matched`)
    },
    app: (_, fn, args) => ctx => (fn(ctx) as Function)(...args.map(arg => arg(ctx))),
    lam: ({ args }, body) => ctx => (...vals: any[]) => body({ ...ctx, ...Object.fromEntries(args.map((arg, i) => [arg.name, vals[i]])) })
})
