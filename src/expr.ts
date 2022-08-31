import { mapValues } from './utils';
import { delay, alt, map, Parser, bet, sep, seq, rep, lit, lbrace, rbrace, name, arrow, backslash, colon, comma, lbracket, lcurly, rbracket, rcurly, eps, sym, dot, digits1, spaces, notChar, rep1, matches, Span, lowerName, upperName, opt, Source, key, sep1 } from './parser';

export type Lit = { type: 'lit', span: Span, value: number | string }
export type Id = { type: 'id', span: Span, name: string }

export type Cons = { type: 'cons', span: Span, name: string, value?: Expr }
export type Rec = { type: 'rec', span: Span, record: { [name: string]: Expr } }
export type List = { type: 'list', span: Span, values: Expr[] }
export type PatCons = { type: 'patcons', span: Span, name: string, value?: Pattern }
export type PatRec = { type: 'patrec', span: Span, record: { [name: string]: Pattern } }
export type PatList = { type: 'patlist', span: Span, values: Pattern[] }

export type App = { type: 'app', span: Span, fn: Expr, args: Expr[] }
export type Lam = { type: 'lam', span: Span, args: Id[], body: Expr }

export type Match = { type: 'match', span: Span, value: Expr, cases: [Pattern, Expr][] }

export type Pattern = Lit | Id | PatCons | PatRec | PatList
export type Expr = Lit | Id | Cons | Rec | List | Pattern | Match | App | Lam

export const strPart = map(rep1(notChar(`'`, '\{', '\}')), arr => arr.join(''));

export const expr: Parser<Expr> = delay(() => map(seq(nonLeftRecursive, leftRecursive), ([e, f]) => f(e)))

// non-left recursive
export const num: Parser<Lit> = map(digits1, (x, span) => ({ type: 'lit', span, value: Number(x) }));
export const id: Parser<Id> = map(alt(lowerName, sym), (name, span) => ({ type: 'id', span, name }));

export const str: Parser<Lit> = map(strPart, (str, span) => ({ type: 'lit', span, value: str }));
export const template: Parser<Expr> = map(bet(lit(`'`), rep(alt<Lit | Expr>(str, bet(lit('{'), bet(spaces, expr, spaces), lit('}')))), lit(`'`)), (parts, span) => {
    if (parts.length === 0) {
        return { type: 'lit', span, value: '' }
    } else {
        let acc: Expr = parts.shift()!;
        for (const part of parts) {
            acc = { type: 'app', span: part.span, fn: { type: 'id', span: part.span, name: '^' }, args: [acc, part] };
        };
        return acc;
    }
});

export const cons: Parser<Cons> = map(seq(upperName, opt(bet(lbrace, expr, rbrace))), ([name, value], span) => ({ type: 'cons', span, name, value }));
export const rec: Parser<Rec> = map(bet(lcurly, sep(map(seq(name, colon, expr), ([name, , val]) => [name, val] as [string, Expr]), comma), rcurly), (entries, span) => ({ type: 'rec', span, record: Object.fromEntries(entries) }));
export const list: Parser<List> = map(bet(lbracket, sep(expr, comma), rbracket), (values, span) => ({ type: 'list', span, values }))

export const pattern: Parser<Pattern> = delay(() => alt<Pattern>(num, id, bet(lit(`'`), str, lit(`'`)), patcons, patrec, patlist));

export const patcons: Parser<PatCons> = map(seq(upperName, opt(bet(lbrace, pattern, rbrace))), ([name, value], span) => ({ type: 'patcons', span, name, value }));
export const patrec: Parser<PatRec> = map(bet(lcurly, sep(map(seq(name, colon, pattern), ([name, , val]) => [name, val] as [string, Pattern]), comma), rcurly), (entries, span) => ({ type: 'patrec', span, record: Object.fromEntries(entries) }));
export const patlist: Parser<PatList> = map(bet(lbracket, sep(pattern, comma), rbracket), (values, span) => ({ type: 'patlist', span, values }))

export const lam: Parser<Lam> = map(seq(backslash, alt(bet(lbrace, sep(id, comma), rbrace), map(id, x => [x])), arrow, expr), ([, args, , body], span) => ({ type: 'lam', span, args, body }))
export const unary: Parser<App> = map(seq(map(sym, (name, span) => ({ type: 'id', span, name } as Id)), expr), ([fn, e], span) => ({ type: 'app', span, fn, args: [e] }))

export const match: Parser<Match> = map(seq(key('match'), expr, sep1(map(seq(key('when'), pattern, arrow, expr), ([, ptn, , expr]) => [ptn, expr] as [Pattern, Expr]), comma)), ([, expr, cases], span) => ({ type: 'match', span, value: expr, cases }))

export const nonLeftRecursive: Parser<Expr> = alt<Expr>(
    match,
    num,
    template,
    rec,
    list,
    cons,
    unary,
    lam,
    id,
    bet(lbrace, delay(() => expr), rbrace)
)

// left recursive
export const prefix_app: Parser<(e: Expr) => App> = map(bet(lbrace, sep(expr, comma), rbrace), (args, span) => fn => ({ type: 'app', span, fn, args }));
export const infix_app: Parser<(e: Expr) => App> = map(seq(map(sym, (name, span) => ({ type: 'id', span, name } as Id)), expr), ([id, arg2], span) => arg1 => ({ type: 'app', span, fn: id, args: [arg1, arg2] }))

export const leftRecursive: Parser<(e: Expr) => Expr> = alt(
    map(seq(alt<(e: Expr) => Expr>(
        prefix_app,
        infix_app,
    ), delay(() => leftRecursive)), ([f, g]) => e => g(f(e))),
    map(eps, () => e => e)
);

export interface ExprWalker<T> {
    lit(e: Lit): T,
    rec(e: Rec, entries: { [name: string]: T }): T,
    list(e: List, values: T[]): T
    cons(e: Cons, value?: T): T,
    id(e: Id): T,
    app(e: App, fn: T, args: T[]): T,
    match(e: Match, value: T, cases: [Pattern, T][]): T,
    lam(e: Lam, body: T): T,
}

export function walkExpr<T>(walker: ExprWalker<T>) {
    const map = new WeakMap();
    const f = (expr: Expr): T => {
        if (map.has(expr)) {
            return map.get(expr);
        } else {
            let t: T;
            if (expr.type === 'lit') {
                t = walker.lit(expr);
            } else if (expr.type === 'rec') {
                t = walker.rec(expr, mapValues(expr.record, f))
            } else if (expr.type === 'list') {
                t = walker.list(expr, expr.values.map(f))
            } else if (expr.type === 'id') {
                t = walker.id(expr)
            } else if (expr.type === 'cons') {
                t = walker.cons(expr, expr.value && f(expr.value))
            } else if (expr.type === 'match') {
                t = walker.match(expr, f(expr.value), expr.cases.map(([ptn, e]) => [ptn, f(e)] as [Pattern, T]))
            } else if (expr.type === 'app') {
                t = walker.app(expr, f(expr.fn), expr.args.map(arg => f(arg)))
            } else if (expr.type === 'lam') {
                t = walker.lam(expr, f(expr.body))
            } else {
                throw new Error(`Impossible`)
            }
            map.set(expr, t)
            return t;
        }
    }
    return f
}

export function toExpr(p: Pattern): Expr {
    if (p.type === 'patcons') {
        return { type: 'cons', span: p.span, name: p.name, value: p.value && toExpr(p.value) }
    } else if (p.type === 'patlist') {
        return { type: 'list', span: p.span, values: p.values.map(toExpr) }
    } else if (p.type === 'patrec') {
        return { type: 'rec', span: p.span, record: mapValues(p.record, toExpr) }
    } else {
        return p;
    }
}

export const freeVars: (e: Expr) => Set<String> = walkExpr<Set<string>>({
    lit: ({ value }) => new Set(),
    rec: (_, record) => new Set(...Object.values(record).map(set => [...set]).flat()),
    list: (_, values) => new Set(...values.map(set => [...set]).flat()),
    id: ({ name }) => new Set([name]),
    cons: ({ name }, value) => value || new Set(),
    match: (_, value, cases) => new Set(...value, cases.map(([p, e]) => {
        const args = freeVars(toExpr(p));
        return new Set([...e].filter(x => !args.has(x)))
    })),
    app: (_, fn, args) => new Set(...fn, ...args.map(set => [...set]).flat()),
    lam: ({ args }, body) => new Set([...body].filter(x => !args.find(arg => arg.name === x)))
})

export const format: (e: Expr) => string = walkExpr<string>({
    lit: ({ value }) => value.toString(),
    rec: (_, record) => '{' + Object.entries(record).map(arr => arr.join(': ')).join(', ') + '}',
    list: (_, values) => `[${values.join(', ')}]`,
    id: ({ name }) => name,
    cons: ({ name }, value) => value ? `${name}(${value})` : name,
    match: (_, value, cases) => `match ${value}\n\t${cases.map(([ptn, e]) => `when ${format(toExpr(ptn))} -> ${e}`).join('\n\t')}`,
    app: (_, fn, args) => matches(sym, fn) ? (args.length == 1 ? `${fn}${args[0]}` : `(${args[0]} ${fn} ${args[1]})`) : `${fn}(${args.join(', ')})`,
    lam: ({ args }, body) => `(\\${args.length > 1 ? '(' + args.map(arg => arg.name).join(', ') + ')' : args.length == 1 ? args[0].name : '()'} -> ${body})`
})
