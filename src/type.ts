
import { Expr, walkExpr } from "./expr";
import { mapValues, Context, filterValues } from "./utils";
import chalk from 'chalk';

export type TCons = { kind: 'cons', name: string, args: Type[] }
export type TId = { kind: 'id', name: string };
export type TRec = { kind: 'rec', record: { [key: string]: Type }, rest?: TId };
export type TLam = { kind: 'lam', args: Type[], result: Type };

export const Num: TCons = { kind: 'cons', name: 'Num', args: [] }
export const Str: TCons = { kind: 'cons', name: 'Str', args: [] }

export function Cons(name: string, ...args: Type[]): TCons {
    return { kind: 'cons', name, args };
}

export function Lam(...types: Type[]): TLam {
    const result = types.pop()!;
    return { kind: 'lam', args: types, result }
}

export type Type = TCons | TId | TRec | TLam

export interface TypeWalker<T> {
    cons(t: TCons, args: T[]): T,
    id(t: TId): T,
    rec(t: TRec, record: { [key: string]: T }, rest?: T): T
    lam(t: TLam, args: T[], result: T,): T
}

export function walkType<T>(walker: TypeWalker<T>) {
    const f = (type: Type): T => {
        if (type.kind === 'cons') {
            return walker.cons(type, type.args.map(f));
        } else if (type.kind === 'id') {
            return walker.id(type);
        } else if (type.kind === 'rec') {
            return walker.rec(type, mapValues(type.record, f), type.rest && f(type.rest));
        } else if (type.kind === 'lam') {
            return walker.lam(type, type.args.map(f), f(type.result));
        } else {
            throw new Error(`Impossible`)
        }
    }
    return f;
}

export const formatType = walkType<string>({
    cons: ({ name }, args) => chalk`{red ${name}}${args.length ? chalk`{red <}${args.join(',')}{red >}` : ''}`,
    id: ({ name }) => chalk.green(name),
    rec: (_, rec, rest) => `{${Object.entries(rec).map(arr => arr.join(': ')).join(', ')}${rest ? ` | ${rest}` : ''}}`,
    lam: (_, args, result) => chalk`{gray (}${args.join(', ')}{gray )} -> ${result}`
})

export const apply = walkType<(ctx: Context<Type>) => Type>({
    cons: ({ name }, args) => ctx => ({ kind: 'cons', name, args: args.map(arg => arg(ctx)) }),
    id: id => ctx => ctx[id.name] || id,
    rec: (_, rec, rest) => ctx => {
        const t = rest && rest(ctx);
        const r = mapValues(rec, val => val(ctx));
        if (t) {
            if (t.kind === 'id') {
                return { kind: 'rec', record: r, rest: t };
            } else if (t.kind === 'rec') {
                return { kind: 'rec', record: { ...r, ...t.record }, rest: fresh() }
            } else {
                throw new Error(`Impossible`)
            }
        } else {
            return { kind: 'rec', record: r }
        }
    },
    lam: (_, args, result) => ctx => ({ kind: 'lam', result: result(ctx), args: args.map(arg => arg(ctx)) })
})

export function applySubst(ctx1: Context<Type>, ctx2: Context<Type>) {
    const newCtx = { ...ctx1, ...ctx2 };
    return mapValues(newCtx, t => apply(t)(ctx1));
}

export const free = walkType<Set<string>>({
    cons: (_, args) => new Set([...args.map(arg => [...arg.values()]).flat()]),
    id: id => new Set([id.name]),
    rec: (_, record, rest) => new Set([...Object.values(record).map(x => [...x.values()]).flat(), ...(rest || [])]),
    lam: (_, args, result) => new Set([...args.map(arg => [...arg.values()]).flat(), ...result.values()])
})

export function occurs(name: string, t: Type) {
    return free(t).has(name);
}

let i = 0;
export function fresh(): TId {
    return { kind: 'id', name: `T${i++}` }
}

export function unify(t1: Type, t2: Type): Context<Type> {
    try {
        if (t1.kind === 'id') { return bind(t1.name, t2) }
        if (t2.kind === 'id') { return bind(t2.name, t1) }

        if (t1.kind !== t2.kind) {
            const displayName = { rec: 'Record', cons: 'TypeConstructor', id: 'Variable', lam: 'Function' }
            throw new Error(`Types have incompatible kinds: ${displayName[t1.kind]} != ${displayName[t2.kind]}`)
        }

        if (t1.kind == 'lam' && t2.kind === 'lam') {
            if (t1.args.length !== t2.args.length) {
                throw new Error(`Function ${formatType(t1)} has different number of arguments (${t1.args.length}) from ${formatType(t2)} ${t2.args.length}`)
            }
            let subst = unify(t1.result, t2.result);
            t1.args.forEach((t1arg, i) => {
                const t2arg = t2.args[i];
                subst = applySubst(unify(apply(t1arg)(subst), apply(t2arg)(subst)), subst);
            })
            return subst;
        }


        if (t1.kind === 'cons' && t2.kind === 'cons') {
            if (t1.name !== t2.name) {
                throw new Error(`Type constructors are incompatible ${t1.name} != ${t2.name}`)
            }

            if (t1.args.length !== t2.args.length) {
                throw new Error(`Type ${formatType(t1)} has different number of arguments (${t1.args.length}) from ${formatType(t2)} ${t2.args.length}`)
            }

            let subst = {};
            t1.args.forEach((t, i) => subst = applySubst(unify(t, t2.args[i]), subst))
            return subst;
        }

        if (t1.kind === 'rec' && t2.kind === 'rec') {
            const intersection = Object.keys(t1.record).filter(k => t2.record[k]);
            let subst = {};
            for (const k of intersection) {
                const s = unify(t1.record[k], t2.record[k]);
                subst = applySubst(s, subst);
            }

            const rest = t1.rest && t2.rest && fresh()
            const t1Minust2 = filterValues(t1.record, (_, k) => !t2.record[k]);
            const t2Minust1 = filterValues(t2.record, (_, k) => !t1.record[k]);
            if (t1.rest) {
                subst = applySubst(unify(t1.rest, { kind: 'rec', record: t2Minust1, rest }), subst);
            } else if (Object.keys(t2Minust1).length) {
                throw new Error(`${formatType(t1)} is not extensible and lacks properties: ${Object.keys(t2Minust1).join(', ')}`)
            }
            if (t2.rest) {
                subst = applySubst(unify(t2.rest, { kind: 'rec', record: t1Minust2, rest }), subst);
            } else if (Object.keys(t1Minust2).length) {
                throw new Error(`${formatType(t2)} is not extensible and lacks properties: [${Object.keys(t1Minust2).join(', ')}]`)
            }
            return subst;
        }

        throw new Error(`could not unify types: ${formatType(t1)} ~ ${formatType(t2)}`)
    } catch (e) {
        throw new Error(`Could not unify types: ${formatType(t1)} ~ ${formatType(t2)}\n\tbecause ${e.message}`)
    }
}

export function bind(name: string, t: Type): Context<Type> {
    if (t.kind === 'id' && t.name === name) {
        return {}
    }
    if (occurs(name, t)) {
        throw new Error(`Infinite type: ${formatType(t)} with name ${name}`)
    }
    return { [name]: t }
}


export const infer = walkExpr<(c: Context<Type>) => [Context<Type>, Type]>({
    lit: ({ value }) => _ => [{}, Num], // TODO: when there are other types
    str: (_, parts) => c => {
        let subst = c;
        parts.forEach(part => {
            if (typeof part !== 'string') {
                const [s, t] = part(subst);
                subst = applySubst(s, subst);
                const s2 = unify(t, Str)
                subst = applySubst(s2, subst);
            }
        })

        return [subst, Str]
    },
    rec: (_, record) => c => {
        let subst = c;
        const t = mapValues(record, (v, k) => {
            const [s, t] = v(subst);
            subst = applySubst(s, subst);
            return t;
        })
        return [subst, { kind: 'rec', record: t }]
    },
    acc: ({ name }, value) => c => {
        const [s, t] = value(c);
        const typeofProp = fresh();
        const subst = applySubst(unify(t, { kind: 'rec', record: { [name]: typeofProp }, rest: fresh() }), s);
        return [subst, apply(typeofProp)(subst)];
    },
    list: (_, values) => c => {
        let subst = {};
        let t: Type = fresh();
        for (const val of values) {
            const [s, tv] = val(c);
            subst = applySubst(s, subst);
            const s2 = unify(t, tv);
            t = apply(t)(s2);
            subst = applySubst(s2, subst);
        }
        return [subst, Cons('List', apply(t)(subst))];
    },
    id: ({ name }) => c => {
        if (c[name]) {
            return [{}, c[name]]
        } else {
            throw new Error(`Could not determine type for variable '${name}'`)
        }
    },
    app: (_, fn, args) => c => {
        const tResult = fresh();
        let [subst, tFn] = fn(c);
        subst = applySubst(subst, c)
        const tArgs = args.map(arg => {
            const [s, tArg] = arg(subst);
            subst = applySubst(s, subst);
            return tArg;
        });

        const uniSubst = unify(apply(tFn)(subst), { kind: 'lam', args: tArgs, result: tResult });
        return [applySubst(uniSubst, subst), apply(tResult)(uniSubst)];
    },
    lam: ({ args }, body) => c => {
        const argTypes = Object.fromEntries(args.map(arg => [arg.name, fresh()]));
        const [subst, t] = body({ ...c, ...argTypes });
        const finalType: TLam = { kind: 'lam', args: args.map(arg => argTypes[arg.name]), result: t };
        return [subst, apply(finalType)(subst)]
    },
});