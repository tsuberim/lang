
import { cons, Expr, freeVars, toConsExpr, toExpr, walkExpr } from "./expr";
import { mapValues, Context, filterValues, isUppercase } from "./utils";
import chalk from 'chalk';
import { alt, bet, colon, delay, key, langle, lbrace, lbracket, lcurly, lowerName, map, opt, Parser, pipe, rangle, rbrace, rcurly, rep, rep1, seq, upperName } from "./parser";

export type TCons = { kind: 'cons', name: string, args: Type[] }
export type TId = { kind: 'id', name: string };
export type TRec = { kind: 'rec', union: boolean, open: boolean, items: { [key: string]: Type }, rest: TId };

let i = 0;
export function fresh(): TId {
    return { kind: 'id', name: `T${i++}` }
}

export const Unit: Type = { kind: 'rec', open: false, union: false, items: {}, rest: fresh() };
export const Void: Type = { kind: 'rec', open: false, union: true, items: {}, rest: fresh() };
export const AnyCons: Type = { kind: 'rec', open: true, union: true, items: {}, rest: fresh() };
export const AnyRec: Type = { kind: 'rec', open: true, union: false, items: {}, rest: fresh() };

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

export type Scheme = {kind: 'scheme', args: string[], type: Type};
export type Subst = Context<Type>;
export type TypeEnv = Context<Scheme>;

export function instantiate(scheme: Scheme): Type {
    const {type, args} = scheme;
    return apply(type)(Object.fromEntries(args.map(arg => [arg, fresh()])))
}

export function generalize(type: Type): Scheme {
    const args = [...free(type)]
    return {kind: 'scheme', args, type};
}

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
            throw new TypeError(`Impossible`)
        }
    }
    return f;
}

export function formatScheme(scheme: Scheme) {
    const subst: Context<TId> = {};
    const names = 'abcdefghijklmnop';
    let i = 0;
    let gen = 0;
    for(const arg of scheme.args) {
        if(i >= names.length) {
            i = 0;
            gen++;
        }
        subst[arg] = {kind: 'id', name: names[i] + (gen ? gen.toString() : '')}
        i++;
    }
    return Object.keys(subst).length ? `${chalk.green`∀${Object.values(subst).map(x => x.name)}.`} ${formatType(applyToType(subst,scheme.type))}` : formatType(scheme.type)
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
    rec: ({ union, open, items }, rec, rest) => {
        const formatCons = (name: string, val: string) => `${name}${val === '{}' ? '' : `<${val}>`}`;
        return `${union ? '[' : '{'}${Object.entries(rec).map(([name, val]) => union ? formatCons(name, val) : `${name}: ${val}`).join(', ')}${union ? ']' : '}'}${open ? rest : ''}`
    }
})

export class TypeError extends Error {
    constructor(msg: string) {
        super(`TypeError: ` + msg);
    }
}

export const apply = walkType<(ctx: Subst) => Type>({
    cons: ({ name }, args) => ctx => ({ kind: 'cons', name, args: args.map(arg => arg(ctx)) }),
    id: id => ctx => ctx[id.name] || id,
    rec: ({ union, open }, rec, rest) => ctx => {
        const t = rest(ctx);
        const r = mapValues(rec, val => val(ctx));
        if (t.kind === 'id') {
            return { kind: 'rec', union, items: r, rest: t, open: open };
        } else if (t.kind === 'rec' && t.union === union) {
            return { kind: 'rec', union, items: { ...r, ...t.items }, rest: fresh(), open: open && t.open }
        } else {
            throw new TypeError(`Impossible`)
        }
    }
})

export function applyToType(subst: Subst, type: Type) {
    return apply(type)(subst);
}

export function applyToScheme(subst: Subst, scheme: Scheme): Scheme {
    return {...scheme, type: applyToType(filterValues(subst, (_,k) => !scheme.args.includes(k)), scheme.type)}
}

export function applySubst(subst: Subst, env: TypeEnv) {
    return mapValues(env, scheme => applyToScheme(subst, scheme))
}

export function compose(ctx1: Subst, ctx2: Subst) {
    const newCtx = { ...ctx1, ...ctx2 };
    return mapValues(newCtx, t => applyToType(ctx1, t));
}

export const free = walkType<Set<string>>({
    cons: (_, args) => new Set([...args.map(arg => [...arg.values()]).flat()]),
    id: id => new Set([id.name]),
    rec: ({open}, record, rest) => new Set([...Object.values(record).map(x => [...x.values()]).flat(), ...(open ? (rest || []): [])]),
})

export function occurs(name: string, t: Type) {
    return free(t).has(name);
}

export function unify(t1: Type, t2: Type): Context<Type> {
    if (t1.kind === 'id') { return bind(t1.name, t2) }
    if (t2.kind === 'id') { return bind(t2.name, t1) }

    if (t1.kind !== t2.kind) {
        const displayName = { rec: 'Record', cons: 'TypeConstructor', id: 'Variable', lam: 'Function' }
        throw new TypeError(`Types have incompatible kinds ${formatType(t1)}, ${formatType(t2)}: ${displayName[t1.kind]} != ${displayName[t2.kind]}`)
    }

    if (t1.kind === 'cons' && t2.kind === 'cons') {
        if (t1.name !== t2.name) {
            throw new TypeError(`Type constructors are incompatible ${formatType(t1)}, ${formatType(t2)}: ${t1.name} != ${t2.name}`)
        }

        if (t1.args.length !== t2.args.length) {
            throw new TypeError(`Type ${formatType(t1)} has different number of arguments (${t1.args.length}) from ${formatType(t2)} ${t2.args.length}`)
        }

        let subst = {};
        t1.args.forEach((t, i) => subst = compose(unify(apply(t)(subst), apply(t2.args[i])(subst)), subst))
        return subst;
    }

    if (t1.kind === 'rec' && t2.kind === 'rec') {
        if (t1.union !== t2.union) {
            throw new TypeError(`${formatType(t1)} is a ${t1.union ? 'union' : 'record'} while ${formatType(t2)} is a ${t2.union ? 'union' : 'record'}`);
        }
        const union = t1.union;

        const intersection = Object.keys(t1.items).filter(k => t2.items[k]);
        let subst = {};
        for (const k of intersection) {
            const s = unify(t1.items[k], t2.items[k]);
            subst = compose(s, subst);
        }

        const rest = fresh()
        subst = compose(unify(rest, t1.rest), subst);
        subst = compose(unify(rest, t2.rest), subst);

        const t1Minust2 = filterValues(t1.items, (_, k) => !t2.items[k]);
        const t2Minust1 = filterValues(t2.items, (_, k) => !t1.items[k]);
        const open = t1.open && t2.open;
        const assignableToT1 = !Object.keys(t2Minust1).length || t1.open;
        const assignableToT2 = !Object.keys(t1Minust2).length || t2.open;
        if (open || (assignableToT1 && assignableToT2)) {
            subst = compose(unify(t1.rest, { kind: 'rec', union, items: t2Minust1, rest, open: open }), subst);
            subst = compose(unify(t2.rest, { kind: 'rec', union, items: t1Minust2, rest, open: open }), subst);
        } else {
            throw new TypeError(`Types are incompatible ${formatType(t1)} !~ ${formatType(t2)}`)
        }
        return subst;
    }

    throw new TypeError(`Could not unify types: ${formatType(t1)} ~ ${formatType(t2)}`)
}

export function bind(name: string, t: Type): Context<Type> {
    if (t.kind === 'id' && t.name === name) {
        return {}
    }
    if (occurs(name, t)) {
        throw new TypeError(`Infinite type: ${formatType(t)} with name ${name}`)
    }
    return { [name]: t }
}

export const reverse = walkType<Type>({
    id: x => x,
    cons: x => x,
    rec: rec => ({ ...rec, open: !rec.open }),
})

export const infer = walkExpr<(c: Context<Scheme>) => [Context<Type>, Type]>({
    lit: ({ value }) => _ => [{}, typeof value === 'number' ? Num : Str],
    rec: (_, record) => c => {
        let subst = {};
        const t: { [key: string]: Type } = mapValues(record, (v, k) => {
            const [s, t] = v(c);
            subst = compose(s, subst);
            return t;
        })
        return [subst, { kind: 'rec', union: false, items: t, open: false, rest: fresh() }]
    },
    list: (_, values) => c => {
        let subst = {};
        let t: Type = fresh();
        for (const val of values) {
            const [s, tv] = val(c);
            subst = compose(s, subst);
            const s2 = unify(t, tv);
            t = apply(t)(s2);
            subst = compose(s2, subst);
        }
        return [subst, Cons('List', apply(t)(subst))];
    },
    id: ({ name }) => c => {
        if (c[name]) {
            return [{}, instantiate(c[name])]
        } else {
            throw new TypeError(`Could not determine type for variable '${name}'`);
        }
    },
    cons: ({ name }, value) => c => {
        if (value) {
            const [s, t] = value(c);
            return [s, { kind: 'rec', union: true, items: { [name]: applyToType(s, t) }, open: true, rest: fresh() }]
        } else {
            return [{}, { kind: 'rec', union: true, items: { [name]: Unit }, open: true, rest: fresh() }]
        }
    },
    match: (e, expr, cases, otherwise) => c => {
        let subst = {};
        let out: Type = fresh();
        let [s, t] = expr(c);
        subst = compose(s, subst);

        // start with empty union
        const options = fresh();
        subst = compose(unify(t, {kind: 'rec', union: true, open: true, items: {}, rest: options}), subst)
        t = apply(t)(subst);

        let tPtn: Type = fresh();
        for (const [ptn, e] of cases) {
            const ptnExpr = toConsExpr(ptn);
            const fv = freeVars(ptnExpr);

            // gather constraints from pattern
            let ctx: TypeEnv = Object.fromEntries([...fv].map(v => [v, {kind: 'scheme', args: [], type: fresh()}]));
            let [substInsideCase, ptnTypeRaw] = infer(ptnExpr)(ctx);
            ctx = applySubst(substInsideCase, ctx);

            // assert that all patterns are of the same type
            subst = compose(unify(tPtn, ptnTypeRaw), subst);
            ptnTypeRaw = apply(ptnTypeRaw)(subst);
            tPtn = apply(tPtn)(subst);

            // infer the type of the consequence given the types of the matched variables
            const [s, tE] = e(applySubst(subst, { ...c, ...ctx }));
            subst = compose(s, subst);
            subst = compose(unify(apply(tE)(subst), out), subst);
            tPtn = apply(tPtn)(subst);
            out = apply(out)(subst)
        }

        // finally unify the expr type with the pattern type (open/closed according to if there's an otherwise branch)
        subst = compose(unify(t, otherwise ? tPtn : reverse(tPtn)), subst);
        t = apply(t)(subst);
        
        if (otherwise) {
            const [s, tOtherwise] = otherwise(c);
            subst = compose(s, subst);
            subst = compose(unify(apply(tOtherwise)(subst), out), subst);
        }

        return [subst, apply(out)(subst)];
    },
    acc: ({prop}, rec) => c => {
        let [subst, t] = rec(c);
        const out = fresh()
        subst = unify(t, { kind: 'rec', items: { [prop]: out }, open: true, union: false, rest: fresh()})
        return [subst, apply(out)(subst)];
    },
    app: (_, fn, args) => c => {
        const tResult = fresh();
        let [subst, tFn] = fn(c);
        const tArgs = args.map(arg => {
            const [s, tArg] = arg(c);
            subst = compose(s, subst);
            return tArg;
        });

        const uniSubst = unify(apply(tFn)(subst), { kind: 'cons', name: 'Func', args: [...tArgs, tResult] });
        return [compose(uniSubst, subst), apply(tResult)(uniSubst)];
    },
    lam: ({ args }, body) => c => {
        const argTypes = Object.fromEntries(args.map(arg => [arg.name, {kind: 'scheme', args: [], type: fresh()} as Scheme]));
        const [subst, t] = body({ ...c, ...argTypes });
        const finalType: TCons = { kind: 'cons', name: 'Func', args: [...args.map(arg => argTypes[arg.name].type), t] };
        return [subst, apply(finalType)(subst)]
    },
});

export function inferScheme(expr: Expr, env: TypeEnv) {
    const [, t] = infer(expr)(env);
    return generalize(t);
}

export const type = delay(() => alt<Type>(tCons, tlam, tId, tRec, tTags));

export const tCons: Parser<TCons> = map(seq(upperName, opt(bet(langle, rep1(type), rangle))), ([name, args]) => ({ kind: 'cons', name, args: args || [] }))
export const tlam: Parser<TCons> = map(seq(bet(langle, rep(type), rangle), key('->'), type), ([args, , result]) => ({ kind: 'cons', name: 'Func', args: [...args, result], }))
export const tId: Parser<TId> = map(lowerName, name => ({ kind: 'id', name }))
export const tRec: Parser<TRec> = map(bet(lcurly, seq(rep(map(seq(lowerName, colon, type), ([k, , v]) => [k, v] as [string, Type])), opt(key('*'))), rcurly), ([entries, open]) => ({ kind: 'rec', union: false, items: Object.fromEntries(entries), rest: fresh(), open: !!open }))
export const tTags: Parser<TRec> = map(bet(lbracket, seq(rep(map(seq(lowerName, opt(bet(lbrace, type, rbrace))), ([k, v]) => [k, v || Unit] as [string, Type])), opt(key('*'))), lbracket), ([entries, open]) => ({ kind: 'rec', union: false, items: Object.fromEntries(entries), rest: fresh(), open: !!open }))