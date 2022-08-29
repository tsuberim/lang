import { walkExpr } from "./expr";
import { mapValues, Context } from "./utils";

export type VNum = number;
export type VStr = string;
export type VLst = Value[]
export type VRec = { [key: string]: Value };
export type VClo = ((...vals: Value[]) => Value)
export type Value = VNum | VStr | VLst | VRec | VClo;

export interface ValueWalker<T> {
    num: (v: VNum) => T;
    str: (v: VStr) => T;
    lst: (v: VLst, values: T[]) => T,
    rec: (v: VRec, rec: { [key: string]: T }) => T;
    clo: (v: VClo) => T;
}

export function walkValue<T>(walker: ValueWalker<T>) {
    const f = (val: Value): T => {
        if (typeof val === 'number') {
            return walker.num(val);
        } else if (typeof val === 'string') {
            return walker.str(val)
        } else if (typeof val === 'object' && !Array.isArray(val)) {
            return walker.rec(val, mapValues(val, f))
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
    num: n => n.toString(),
    str: str => '`' + str + '`',
    lst: (_, vals) => `[${vals.join(', ')}]`,
    rec: (_, rec) => `{${Object.entries(rec).map(arr => arr.join(': ')).join(', ')}}`,
    clo: f => `<closure>`
});

export const evaluate = walkExpr<(ctx: Context<Value>) => Value>({
    lit: ({ value }) => _ => value,
    str: (_, parts) => ctx => parts.map(part => typeof part === 'string' ? part : part(ctx)).join(''),
    list: (_, values) => ctx => values.map(val => val(ctx)),
    rec: (_, record) => ctx => mapValues(record, v => v(ctx)),
    acc: ({ name }, val) => ctx => (val(ctx) as VRec)[name],
    id: ({ name }) => ctx => ctx[name],
    app: (_, fn, args) => ctx => (fn(ctx) as Function)(...args.map(arg => arg(ctx))),
    lam: ({ args }, body) => ctx => (...vals: any[]) => body({ ...ctx, ...Object.fromEntries(args.map((arg, i) => [arg.name, vals[i]])) })
})
