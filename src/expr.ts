import { mapValues } from './utils';
import { delay, alt, map, Parser, pat, key, bet, sep, seq, rep, lit, lbrace, rbrace, name, arrow, at, backslash, colon, comma, lbracket, lcurly, rbracket, rcurly, eps, sym, dot, symPattern } from './parser';

export type Lit = { type: 'lit', value: number | string }
export type Str = { type: 'str', parts: (string | Expr)[] }
export type Rec = { type: 'rec', record: { [name: string]: Expr } }
export type Acc = { type: 'acc', value: Expr, name: string };
export type List = { type: 'list', values: Expr[] }
export type Id = { type: 'id', name: string }
export type App = { type: 'app', fn: Expr, args: Expr[] }
export type Lam = { type: 'lam', args: Id[], body: Expr }

export type Expr = Lit | Id | Str | Rec | Acc | List | App | Lam

export const strPartPatern = /^[^`\{\}]+/;
export const strPart = pat(strPartPatern);

export const expr: Parser<Expr> = delay(() => map(seq(nonLeftRecursive, leftRecursive), ([e, f]) => f(e)))

export const nonLeftRecursive: Parser<Expr> = delay(() => alt<Expr>(
    num,
    id,
    str,
    rec,
    list,
    lam,
    bet(lbrace, expr, rbrace)
))

export const leftRecursive: Parser<(e: Expr) => Expr> = delay(() => alt(
    map(seq(alt<(e: Expr) => Expr>(
        acc,
        prefix_app,
        infix_app,
    ), leftRecursive), ([f, g]) => e => g(f(e))),
    map(eps, () => e => e)
));

// non-left recursive
export const num: Parser<Lit> = map(pat(/\d+/), x => ({ type: 'lit', value: Number(x) }));
export const id: Parser<Id> = map(alt(name, sym), name => ({ type: 'id', name }));
export const str: Parser<Str> = map(bet(lit('`'), rep(alt<string | Expr>(strPart, bet(lit('{'), bet(pat(/\s*/), expr, pat(/\s*/)), lit('}')))), lit('`')), parts => ({ type: 'str', parts }));
export const rec: Parser<Rec> = map(bet(lcurly, sep(map(seq(name, colon, expr), ([name, , val]) => [name, val] as [string, Expr]), comma), rcurly), (entries) => ({ type: 'rec', record: Object.fromEntries(entries) }));
export const list: Parser<List> = map(bet(lbracket, sep(expr, comma), rbracket), values => ({ type: 'list', values }))
export const lam: Parser<Lam> = map(seq(backslash, alt(bet(lbrace, sep(id, comma), rbrace), map(id, x => [x])), arrow, expr), ([, args, , body]) => ({ type: 'lam', args, body }))

// left recursive
export const prefix_app: Parser<(e: Expr) => App> = map(bet(lbrace, sep(expr, comma), rbrace), (args) => fn => ({ type: 'app', fn, args }));
export const infix_app: Parser<(e: Expr) => App> = map(seq(sym, expr), ([id, arg2]) => arg1 => ({ type: 'app', fn: { type: 'id', name: id }, args: [arg1, arg2] }))
export const acc: Parser<(e: Expr) => Acc> = map(seq(dot, name), ([, n]) => e => ({ type: 'acc', value: e, name: n }))

export interface ExprWalker<T> {
    lit(e: Lit): T,
    str(e: Str, parts: (string | T)[]): T,
    rec(e: Rec, entries: { [name: string]: T }): T,
    acc(e: Acc, value: T): T,
    list(e: List, values: T[]): T
    id(e: Id): T,
    app(e: App, fn: T, args: T[]): T,
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
            } else if (expr.type === 'str') {
                t = walker.str(expr, expr.parts.map(part => typeof part === 'string' ? part : f(part as Expr)));
            } else if (expr.type === 'rec') {
                t = walker.rec(expr, mapValues(expr.record, f))
            } else if (expr.type === 'acc') {
                t = walker.acc(expr, f(expr.value))
            } else if (expr.type === 'list') {
                t = walker.list(expr, expr.values.map(f))
            } else if (expr.type === 'id') {
                t = walker.id(expr)
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

export const format = walkExpr<string>({
    lit: ({ value }) => value.toString(),
    str: (_, parts) => '`' + parts.map(part => typeof part === 'string' ? part : '{' + part + '}').join('') + '`',
    rec: (_, record) => '{' + Object.entries(record).map(arr => arr.join(': ')).join(', ') + '}',
    acc: ({ name }, e) => `${e}.${name}`,
    list: (_, values) => `[${values.join(', ')}]`,
    id: ({ name }) => name,
    app: (_, fn, args) => fn.match(symPattern) ? `(${args[0]} ${fn} ${args[1]})` : `${fn}(${args.join(', ')})`,
    lam: ({ args }, body) => `\\${args.length > 1 ? '(' + args.map(arg => arg.name).join(', ') + ')' : args.length == 1 ? args[0].name : '()'} -> ${body}`
})
