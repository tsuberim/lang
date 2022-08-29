import { assertEq, throws } from './utils'

export type Parser<T> = (input: string) => [T, string];

export function parse<T>(parser: Parser<T>, input: string): T {
    return parser(input)[0];
}

assertEq(parse(lit('hello'), 'hello'), 'hello')
throws(() => parse(lit('hello'), 'hola'))
export function lit(str: string): Parser<string> {
    return (input) => {
        if (input.startsWith(str)) {
            return [input.slice(0, str.length), input.slice(str.length)]
        } else {
            throw new Error(`Expected literal '${str}'`);
        }
    }
}

assertEq(parse(map(lit('hello'), x => x.length), 'hello'), 5)
export function map<T, K>(parser: Parser<T>, fn: (t: T) => K): Parser<K> {
    return (input) => {
        const [result, rest] = parser(input);
        return [fn(result), rest];
    }
}

assertEq(parse(pat(/\d+/), '123'), '123');
throws(() => parse(pat(/\d+/), 'abc'))
throws(() => parse(pat(/\d+/), 'a123'))
export function pat(regex: RegExp): Parser<string> {
    return (input) => {

        const match = input.match(regex);
        if (match && match.index === 0) {
            const m = match[0];
            return [m, input.slice(m.length)]
        } else {
            throw new Error(`Does not match pattern: ${regex}`)
        }
    }
}

assertEq(parse(seq(lit('hello'), lit('world')), 'helloworld'), ['hello', 'world'])
throws(() => parse(seq(lit('hello'), lit('world')), 'hellohola'))
export function seq<ARGS extends any[]>(...parsers: { [T in keyof ARGS]: Parser<ARGS[T]> }): Parser<ARGS> {
    return (input: string) => {
        const out: any[] = [];
        for (const parser of parsers) {
            const [parsed, rest] = parser(input);
            input = rest;
            out.push(parsed);
        }
        return [out as any, input];
    }
}

assertEq(parse(alt(lit('hello'), lit('hola')), 'hello'), 'hello')
assertEq(parse(alt(lit('hello'), lit('hola')), 'hola'), 'hola')
throws(() => parse(alt(lit('hello'), lit('hola')), 'foobar'))
export function alt<T>(...parsers: Parser<T>[]): Parser<T> {
    return (input) => {
        const errs = [];
        for (const parser of parsers) {
            try {
                return parser(input);
            } catch (e) {
                errs.push(e);
            }
        }
        throw new Error(`No parser matched:\n\t${errs.map(e => e.message).join('\n\t')}`)
    }
}

assertEq(parse(rep(lit('foo')), ''), [])
assertEq(parse(rep(lit('foo')), 'foo'), ['foo'])
assertEq(parse(rep(lit('foo')), 'foofoo'), ['foo', 'foo'])
throws(() => parse(rep(lit('foo')), 'fosofoo'))
export function rep<T>(parser: Parser<T>): Parser<T[]> {
    return (input) => {
        const out: T[] = [];
        try {
            while (true) {
                const [result, rest] = parser(input);
                input = rest;
                out.push(result)
            }
        } catch (e) { };
        return [out, input];
    }
}


assertEq(parse(sep(pat(/\d+/), lit(',')), '123,124,125'), ['123', '124', '125'])
assertEq(parse(sep(pat(/\d+/), lit(',')), '123,124,125,'), ['123', '124', '125'])
throws(() => parse(sep(pat(/\d+/), lit(',')), ',123,124,125'))
throws(() => parse(sep(pat(/\d+/), lit(',')), 'foobar,123'))
export function sep<T>(parser: Parser<T>, delimiter: Parser<any>): Parser<T[]> {
    return rep(alt(map(seq(parser, delimiter), ([x]) => x), parser));
}

assertEq(parse(bet(lit('('), lit('hello'), lit(')')), '(hello)'), 'hello')
throws(() => parse(bet(lit('('), lit('hello'), lit(')')), '(foobar)'))
throws(() => parse(bet(lit('('), lit('hello'), lit(')')), ')hello)'))
export function bet<T>(left: Parser<any>, parser: Parser<T>, right: Parser<any>): Parser<T> {
    return map(seq(left, parser, right), ([_, x]) => x);
}

assertEq(parse(opt(lit('hello')), 'hello'), 'hello')
assertEq(parse(opt(lit('hello')), 'hola'), null)
export function opt<T>(parser: Parser<T>): Parser<T | null> {
    return alt(parser, map(lit(''), _ => null))
}

assertEq(parse(key('foobar'), '  foobar\t\n'), 'foobar')
throws(() => parse(key('foobar'), '  foobrar\t\n'))
export function key(str: string) {
    return bet(pat(/\s*/), lit(str), pat(/\s*/));
}


export function delay<T>(thunk: () => Parser<T>): Parser<T> {
    return (input) => {
        const parser = thunk();
        return parser(input);
    }
}


assertEq(parse(end, ''), true)
throws(() => parse(end, 'asdf'))
export function end(input: string): [true, string] {
    if (input === '') {
        return [true, ''];
    } else {
        throw new Error(`Expected end of input`)
    }
}

export const lbrace = key('(');
export const rbrace = key(')');
export const lcurly = key('{');
export const rcurly = key('}');
export const lbracket = key('[');
export const rbracket = key(']');
export const langle = key('<');
export const rangle = key('>');
export const comma = key(',');
export const colon = key(':');
export const pipe = key('|');
export const backslash = key('\\');
export const at = key('@');
export const arrow = key('->');
export const namePattern = /^[a-zA-Z][a-zA-Z0-0]*/;
export const name = pat(namePattern);