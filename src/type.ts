
import { Expr, freeVars, toExpr, walkExpr } from "./expr";
import { mapValues, Context, filterValues, isUppercase } from "./utils";
import chalk from 'chalk';
import { alt, bet, colon, delay, key, langle, lcurly, lowerName, map, opt, Parser, pipe, rangle, rcurly, rep, seq, upperName } from "./parser";

export type TCons = { kind: 'cons', name: string, args: Type[] }
export type TId = { kind: 'id', name: string };
export type TRec = { kind: 'rec', union: boolean, partial: boolean, items: { [key: string]: Type }, rest: TId };

let i = 0;
export function fresh(): TId {
    return { kind: 'id', name: `T${i++}` }
}

export const Unit: Type = { kind: 'rec', partial: false, union: false, items: {}, rest: fresh() };
export const Void: Type = { kind: 'rec', partial: false, union: true, items: {}, rest: fresh() };

export function Cons(name: string, ...args: Type[]): TCons {
    return { kind: 'cons', name, args };
}

export function List(type: Type): TCons {
    return Cons('List', type);
}

export const Num: TCons = Cons('Num')
export const Str: TCons = Cons('Str')

export function Lam(...types: Type[]): TCons {
    return { kind: 'cons', name: 'Func', args: types }
}

export type Type = TCons | TId | TRec | TCons

export interface TypeWalker<T> {
    cons(t: TCons, args: T[]): T,
    id(t: TId): T,
    rec(t: TRec, record: { [key: string]: T }, rest: T): T
}

export function walkType<T>(walker: TypeWalker<T>) {
    const f = (type: Type): T => {
        if (type.kind === 'cons') {
            return walker.cons(type, type.args.map(f));
        } else if (type.kind === 'id') {
            return walker.id(type);
        } else if (type.kind === 'rec') {
            return walker.rec(type, mapValues(type.items, f), f(type.rest));
        } else {
            throw new Error(`Impossible`)
        }
    }
    return f;
}

export const formatType = walkType<string>({
    cons: ({ name }, args) => {
        if (name === 'Func') {
            const copy = [...args];
            const result = copy.pop()
            return chalk`{red <${copy.join(',')}> -> ${result}}`
        } else {
            return chalk`{red ${name}}${args.length ? chalk`{red <}${args.join(',')}{red >}` : ''}`
        }
    },
    id: ({ name }) => chalk.green(name),
    rec: ({ union, partial, items }, rec, rest) => {
        const formatCons = (name: string, val: string) => `${name}${val === '{}' ? '' : `<${val}>`}`;
        if (union && Object.keys(rec).length === 1) {
            const k = Object.keys(rec)[0];
            return formatCons(k, rec[k]);
        }
        return `${union ? '[' : '{'}${partial ? `* ` : ''}${Object.entries(rec).map(([name, val]) => union ? formatCons(name, val) : `${name}: ${val}`).join(', ')}${union ? ']' : '}'}`
    }
})

export const apply = walkType<(ctx: Context<Type>) => Type>({
    cons: ({ name }, args) => ctx => ({ kind: 'cons', name, args: args.map(arg => arg(ctx)) }),
    id: id => ctx => ctx[id.name] || id,
    rec: ({ union, partial }, rec, rest) => ctx => {
        const t = rest(ctx);
        const r = mapValues(rec, val => val(ctx));
        if (t.kind === 'id') {
            return { kind: 'rec', union, items: r, rest: t, partial };
        } else if (t.kind === 'rec' && t.union === union) {
            return { kind: 'rec', union, items: { ...r, ...t.items }, rest: fresh(), partial: union ? (partial || t.partial) : (partial && t.partial) }
        } else {
            throw new Error(`Impossible`)
        }
    }
})

export function applySubst(ctx1: Context<Type>, ctx2: Context<Type>) {
    const newCtx = { ...ctx1, ...ctx2 };
    return mapValues(newCtx, t => apply(t)(ctx1));
}

export const free = walkType<Set<string>>({
    cons: (_, args) => new Set([...args.map(arg => [...arg.values()]).flat()]),
    id: id => new Set([id.name]),
    rec: (_, record, rest) => new Set([...Object.values(record).map(x => [...x.values()]).flat(), ...(rest || [])]),
})

export function occurs(name: string, t: Type) {
    return free(t).has(name);
}

export function unify(t1: Type, t2: Type): Context<Type> {
    if (t1.kind === 'id') { return bind(t1.name, t2) }
    if (t2.kind === 'id') { return bind(t2.name, t1) }

    if (t1.kind !== t2.kind) {
        const displayName = { rec: 'Record', cons: 'TypeConstructor', id: 'Variable', lam: 'Function' }
        throw new Error(`Types have incompatible kinds: ${displayName[t1.kind]} != ${displayName[t2.kind]}`)
    }

    if (t1.kind === 'cons' && t2.kind === 'cons') {
        if (t1.name !== t2.name) {
            throw new Error(`Type constructors are incompatible ${t1.name} != ${t2.name}`)
        }

        if (t1.args.length !== t2.args.length) {
            throw new Error(`Type ${formatType(t1)} has different number of arguments (${t1.args.length}) from ${formatType(t2)} ${t2.args.length}`)
        }

        let subst = {};
        t1.args.forEach((t, i) => subst = applySubst(unify(apply(t)(subst), apply(t2.args[i])(subst)), subst))
        return subst;
    }

    if (t1.kind === 'rec' && t2.kind === 'rec') {
        if (t1.union !== t2.union) {
            throw new Error(`${formatType(t1)} is a ${t1.union ? 'union' : 'record'} while ${formatType(t2)} is a ${t2.union ? 'union' : 'record'}`);
        }
        const union = t1.union;

        const intersection = Object.keys(t1.items).filter(k => t2.items[k]);
        let subst = {};
        for (const k of intersection) {
            const s = unify(t1.items[k], t2.items[k]);
            subst = applySubst(s, subst);
        }

        const rest = fresh()
        subst = applySubst(unify(rest, t1.rest), subst);
        subst = applySubst(unify(rest, t2.rest), subst);

        const t1Minust2 = filterValues(t1.items, (_, k) => !t2.items[k]);
        const t2Minust1 = filterValues(t2.items, (_, k) => !t1.items[k]);
        const partial = union ? (t1.partial || t2.partial) : (t1.partial && t2.partial);
        if (t1.partial || union) {
            subst = applySubst(unify(t1.rest, { kind: 'rec', union, items: t2Minust1, rest, partial }), subst);
        } else if (Object.keys(t2Minust1).length) {
            throw new Error(`${formatType(t1)} is not extensible and lacks properties: ${Object.keys(t2Minust1).join(', ')}`)
        }
        if (t2.partial || union) {
            subst = applySubst(unify(t2.rest, { kind: 'rec', union, items: t1Minust2, rest, partial }), subst);
        } else if (Object.keys(t1Minust2).length) {
            throw new Error(`${formatType(t2)} is not extensible and lacks properties: [${Object.keys(t1Minust2).join(', ')}]`)
        }
        return subst;
    }

    throw new Error(`Could not unify types: ${formatType(t1)} ~ ${formatType(t2)}`)
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
    lit: ({ value }) => _ => [{}, typeof value === 'number' ? Num : Str],
    rec: (_, record) => c => {
        let subst = c;
        const t: { [key: string]: Type } = mapValues(record, (v, k) => {
            const [s, t] = v(subst);
            subst = applySubst(s, subst);
            return t;
        })
        return [subst, { kind: 'rec', union: false, items: t, partial: false, rest: fresh() }]
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
            throw new Error(`Could not determine type for variable '${name}'`);
        }
    },
    cons: ({ name }, value) => c => {
        if (value) {
            let subst = c;
            const [s, t] = value(c);
            subst = applySubst(s, c);
            return [subst, { kind: 'rec', union: true, items: { [name]: apply(t)(subst) }, partial: false, rest: fresh() }]
        } else {
            return [{}, { kind: 'rec', union: true, items: { [name]: Unit }, partial: false, rest: fresh() }]
        }
    },
    match: (e, expr, cases) => c => {
        let subst = c;
        const out = fresh();
        const [s,t] = expr(c);
        subst = applySubst(s, subst);

        for(const [ptn, e] of cases) {
            const fv = freeVars(toExpr(ptn));
            const [substInsideCase, ptnType] = infer(toExpr(ptn))(Object.fromEntries([...fv].map(v => [v, fresh()])));
            subst = applySubst(unify(t, ptnType), subst);
            const [s, tE] = e({...subst, ...substInsideCase});
            subst = applySubst(s, subst)
            subst = applySubst(unify(apply(tE)(subst), apply(out)(subst)), subst);
        }

        return [subst, apply(out)(subst)];
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

        const uniSubst = unify(apply(tFn)(subst), { kind: 'cons', name: 'Func', args: [...tArgs, tResult] });
        return [applySubst(uniSubst, subst), apply(tResult)(uniSubst)];
    },
    lam: ({ args }, body) => c => {
        const argTypes = Object.fromEntries(args.map(arg => [arg.name, fresh()]));
        const [subst, t] = body({ ...c, ...argTypes });
        const finalType: TCons = { kind: 'cons', name: 'Func', args: [...args.map(arg => argTypes[arg.name]), t] };
        return [subst, apply(finalType)(subst)]
    },
});


export const type = delay(() => alt<Type>(tCons, tlam, tId, tRec));

export const tCons: Parser<TCons> = map(seq(upperName, bet(langle, rep(type), rangle)), ([name, args]) => ({ kind: 'cons', name, args }))
export const tlam: Parser<TCons> = map(seq(bet(langle, rep(type), rangle), key('->'), type), ([args, , result]) => ({ kind: 'cons', name: 'Func', args: [...args, result], }))
export const tId: Parser<TId> = map(lowerName, name => ({ kind: 'id', name }))
export const tRec: Parser<TRec> = map(bet(lcurly, seq(rep(map(seq(lowerName, colon, type), ([k, , v]) => [k, v] as [string, Type])), opt(key('*'))), rcurly), ([entries, partial]) => ({ kind: 'rec', union: false, items: Object.fromEntries(entries), rest: fresh(), partial: !!partial }))