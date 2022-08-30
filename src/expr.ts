import { mapValues } from './utils';
import { delay, alt, map, Parser, bet, sep, seq, rep, lit, lbrace, rbrace, name, arrow, backslash, colon, comma, lbracket, lcurly, rbracket, rcurly, eps, sym, dot, digits1, spaces, notChar, rep1, matches, Span, lowerName, upperName, opt } from './parser';

export type Lit = { type: 'lit', span: Span, value: number | string }
export type Str = { type: 'str', span: Span, parts: (string | Expr)[] }
export type Rec = { type: 'rec', span: Span, record: { [name: string]: Expr } }
export type Acc = { type: 'acc', span: Span, value: Expr, name: string };
export type List = { type: 'list', span: Span, values: Expr[] }
export type Cons = { type: 'cons', span: Span, name: string, value?: Expr }
export type Id = { type: 'id', span: Span, name: string }
export type App = { type: 'app', span: Span, fn: Expr, args: Expr[] }
export type Lam = { type: 'lam', span: Span, args: Id[], body: Expr }

export type Expr = Lit | Id | Cons | Str | Rec | Acc | List | App | Lam

export const strPart = map(rep1(notChar('`', '\{', '\}')), arr => arr.join(''));

export const expr: Parser<Expr> = delay(() => map(seq(nonLeftRecursive, leftRecursive), ([e, f]) => f(e)))

// non-left recursive
export const num: Parser<Lit> = map(digits1, (x, span) => ({ type: 'lit', span, value: Number(x) }));
export const id: Parser<Id> = map(alt(lowerName, sym), (name, span) => ({ type: 'id', span, name }));
export const cons: Parser<Cons> = map(seq(upperName, opt(bet(lbrace, expr, rbrace))), ([name, value], span) => ({ type: 'cons', span, name, value: value || undefined }));
export const str: Parser<Str> = map(bet(lit('`'), rep(alt<string | Expr>(strPart, bet(lit('{'), bet(spaces, expr, spaces), lit('}')))), lit('`')), (parts, span) => ({ type: 'str', span, parts }));
export const rec: Parser<Rec> = map(bet(lcurly, sep(map(seq(name, colon, expr), ([name, , val]) => [name, val] as [string, Expr]), comma), rcurly), (entries, span) => ({ type: 'rec', span, record: Object.fromEntries(entries) }));
export const list: Parser<List> = map(bet(lbracket, sep(expr, comma), rbracket), (values, span) => ({ type: 'list', span, values }))
export const lam: Parser<Lam> = map(seq(backslash, alt(bet(lbrace, sep(id, comma), rbrace), map(id, x => [x])), arrow, expr), ([, args, , body], span) => ({ type: 'lam', span, args, body }))
export const unary: Parser<App> = map(seq(map(sym, (name, span) => ({ type: 'id', span, name } as Id)), expr), ([fn, e], span) => ({ type: 'app', span, fn, args: [e] }))

export const nonLeftRecursive: Parser<Expr> = alt<Expr>(
    num,
    unary,
    id,
    cons,
    str,
    rec,
    list,
    lam,
    bet(lbrace, delay(() => expr), rbrace)
)

// left recursive
export const prefix_app: Parser<(e: Expr) => App> = map(bet(lbrace, sep(expr, comma), rbrace), (args, span) => fn => ({ type: 'app', span, fn, args }));
export const infix_app: Parser<(e: Expr) => App> = map(seq(map(sym, (name, span) => ({ type: 'id', span, name } as Id)), expr), ([id, arg2], span) => arg1 => ({ type: 'app', span, fn: id, args: [arg1, arg2] }))
export const acc: Parser<(e: Expr) => Acc> = map(seq(dot, name), ([, n], span) => e => ({ type: 'acc', span, value: e, name: n }))

export const leftRecursive: Parser<(e: Expr) => Expr> = alt(
    map(seq(alt<(e: Expr) => Expr>(
        acc,
        prefix_app,
        infix_app,
    ), delay(() => leftRecursive)), ([f, g]) => e => g(f(e))),
    map(eps, () => e => e)
);

export interface ExprWalker<T> {
    lit(e: Lit): T,
    str(e: Str, parts: (string | T)[]): T,
    rec(e: Rec, entries: { [name: string]: T }): T,
    acc(e: Acc, value: T): T,
    list(e: List, values: T[]): T
    cons(e: Cons, value?: T): T,
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
            } else if (expr.type === 'cons') {
                t = walker.cons(expr, expr.value && f(expr.value))
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
    cons: ({ name }, value) => value ? `${name}(${value})` : name,
    app: (_, fn, args) => matches(sym, fn) ? (args.length == 1 ? `${fn}${args[0]}` : `(${args[0]} ${fn} ${args[1]})`) : `${fn}(${args.join(', ')})`,
    lam: ({ args }, body) => `(\\${args.length > 1 ? '(' + args.map(arg => arg.name).join(', ') + ')' : args.length == 1 ? args[0].name : '()'} -> ${body})`
})
