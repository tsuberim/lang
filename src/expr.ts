import { mapValues, trace } from './utils';
import { parse, delay, alt, map, Parser, pat, key, bet, sep, seq, rep, lit, lbrace, rbrace, name, arrow, at, backslash, colon, comma, lbracket, lcurly, rbracket, rcurly } from './parser';

export type Lit = { type: 'lit', value: number | string }
export type Str = { type: 'str', parts: (string | Expr)[] }
export type Rec = { type: 'rec', record: { [name: string]: Expr } }
export type List = { type: 'list', values: Expr[] }
export type Id = { type: 'id', name: string }
export type App = { type: 'app', fn: Expr, args: Expr[] }
export type Lam = { type: 'lam', args: Id[], body: Expr }

export type Expr = Lit | Id | Str | Rec | List | App | Lam

export const strPartPatern = /^[^`\{\}]+/;
export const strPart = pat(strPartPatern);

export const expr: Parser<Expr> = delay(() => alt<Expr>(
    num,
    id,
    str,
    rec,
    list,
    app,
    lam,
    bet(lbrace, expr, rbrace)
))

export const num: Parser<Lit> = map(pat(/\d+/), x => ({ type: 'lit', value: Number(x) }));
export const id: Parser<Id> = map(name, name => ({ type: 'id', name }));
export const str: Parser<Str> = map(bet(lit('`'), rep(alt<string | Expr>(strPart, bet(lit('{'), bet(pat(/\s*/), expr, pat(/\s*/)), lit('}')))), lit('`')), parts => ({ type: 'str', parts }));
export const rec: Parser<Rec> = map(bet(lcurly, sep(map(seq(name, colon, expr), ([name, , val]) => [name, val] as [string, Expr]), comma), rcurly), (entries) => ({ type: 'rec', record: Object.fromEntries(entries) }));
export const list: Parser<List> = map(bet(lbracket, sep(expr, comma), rbracket), values => ({ type: 'list', values }))
export const app: Parser<App> = map(seq(at, expr, bet(lbrace, sep(expr, comma), rbrace)), ([, fn, args]) => ({ type: 'app', fn, args }));
export const lam: Parser<Lam> = map(seq(backslash, alt(bet(lbrace, sep(id, comma), rbrace), map(id, x => [x])), arrow, expr), ([, args, , body]) => ({ type: 'lam', args, body }))

export interface ExprWalker<T> {
    lit(e: Lit): T,
    str(e: Str, parts: (string | T)[]): T,
    rec(e: Rec, entries: { [name: string]: T }): T,
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
    list: (_, values) => `[${values.join(', ')}]`,
    id: ({ name }) => name,
    app: (_, fn, args) => `@${fn}(${args.join(', ')})`,
    lam: ({ args }, body) => `\\${args.length > 1 ? args.map(arg => arg.name).join(', ') : args.length == 1 ? args[0] : '()'} -> ${body}`
})
