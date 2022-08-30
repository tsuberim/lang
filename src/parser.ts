import fs, { ReadStream } from 'fs-extra';
import { Readable } from 'stream';
import { assertEq, throws } from './utils'

export interface Pos {
    chars: number
    line: number,
    column: number,
    indent: number
}

export function formatPos({ line, column }: Pos) {
    return `${line}:${column}`;
}

export type Span = [Pos, Pos];

export function formatSpan([p1, p2]: Span) {
    return `[${formatPos(p1)}-${formatPos(p2)}]`;
}

export class BufferedString {
    private acc: string = '';
    constructor(private readable: Readable) { }

    slice(from: number, to: number): string {
        const more = to - this.acc.length;
        if (more > 0) {
            this.acc += this.readable.read(more);
        }
        return this.acc.slice(from, to);
    }
}

export class Source {
    static END = '\u0000';
    static INDENT = '\u0001';
    static DEDENT = '\u0002';

    constructor(private str: BufferedString, public pos: Pos = { chars: 0, line: 0, column: 0, indent: 0 }) { }

    static fromString(str: string) {
        return ReadStream.from(str);
    }

    static fromFile(path: string) {
        return fs.createReadStream(path, 'utf-8');
    }

    skip(n: number): Source {
        const str = this.peek(n);
        let { chars, line, column, indent } = { ...this.pos };
        for (const char of str) {
            if (char === Source.END || char === Source.INDENT || char === Source.DEDENT) {
                throw new Error(`Invalid reserved char ${char}`);
            }
            if (char === '\n') {
                line++;
                column = 1;
            }
            chars++;
            column++;
        }
        return new Source(this.str, { chars, line, column, indent });
    }

    peek(n: number): string {
        const str = this.str.slice(this.pos.chars, this.pos.chars + n);
        if (str.length < n) {
            return str + Source.END;
        } else {
            return str;
        }
    }
}

export type Parser<T> = (input: Source) => [T, Source];

export function parse<T>(parser: Parser<T>, input: string): T {
    return parser(new Source(new BufferedString(ReadStream.from(input))))[0];
}

export function parseFile<T>(parser: Parser<T>, path: string): T {
    return parser(new Source(new BufferedString(fs.createReadStream(path, 'utf-8'))))[0];
}

export function matches<T>(parser: Parser<T>, input: string): boolean {
    try {
        parse(parser, input);
        return true;
    } catch (e) {
        return false;
    }
}

assertEq(parse(lit('hello'), 'hello'), 'hello')
throws(() => parse(lit('hello'), 'hola'))
export function lit(str: string): Parser<string> {
    return (input) => {
        const start = input.peek(str.length);
        if (start.startsWith(str)) {
            return [input.peek(str.length), input.skip(str.length)]
        } else {
            throw new Error(`Expected literal '${str}'`);
        }
    }
}

assertEq(parse(map(lit('hello'), x => x.length), 'hello'), 5)
export function map<T, K>(parser: Parser<T>, fn: (t: T, span: Span) => K): Parser<K> {
    return (input) => {
        const [result, rest] = parser(input);
        return [fn(result, [input.pos, rest.pos]), rest];
    }
}

export function range(from: string, to: string): Parser<string> {
    return source => {
        const char = source.peek(1);
        if (from <= char && char <= to) {
            return [char, source.skip(1)]
        } else {
            throw new Error(`Expected a char between ${from} and ${to}`)
        }
    }
}

export function notChar(...chars: string[]): Parser<string> {
    return source => {
        const char = source.peek(1);
        if (!chars.includes(char)) {
            return [char, source.skip(1)]
        } else {
            throw new Error(`Expected a char not from: [${chars.join(',')}]`)
        }
    }
}


assertEq(parse(seq(lit('hello'), lit('world')), 'helloworld'), ['hello', 'world'])
throws(() => parse(seq(lit('hello'), lit('world')), 'hellohola'))
export function seq<ARGS extends any[]>(...parsers: { [T in keyof ARGS]: Parser<ARGS[T]> }): Parser<ARGS> {
    return (input: Source) => {
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

export function rep1<T>(parser: Parser<T>): Parser<T[]> {
    return map(seq(parser, rep(parser)), ([t, arr]) => [t, ...arr]);
}


export function sep<T>(parser: Parser<T>, delimiter: Parser<any>): Parser<T[]> {
    return rep(alt(map(seq(parser, delimiter), ([x]) => x), parser));
}

export function bet<T>(left: Parser<any>, parser: Parser<T>, right: Parser<any>): Parser<T> {
    return map(seq(left, parser, right), ([_, x]) => x);
}

export function opt<T>(parser: Parser<T>): Parser<T | null> {
    return alt(parser, map(lit(''), _ => null))
}

export function key(str: string) {
    return bet(spaces, lit(str), spaces);
}


export function delay<T>(thunk: () => Parser<T>): Parser<T> {
    return (input) => {
        const parser = thunk();
        return parser(input);
    }
}


assertEq(parse(end, ''), true)
throws(() => parse(end, 'asdf'))
export function end(input: Source): [true, Source] {
    if (input.peek(1) === Source.END) {
        return [true, input];
    } else {
        throw new Error(`Expected end of input`)
    }
}

export const lowercase = range('a', 'z');
export const uppercase = range('A', 'Z');
export const letter = alt(lowercase, uppercase);
export const letters = rep(letter);
export const letters1 = rep1(letter);

export const digit = range('0', '9');
export const digits = map(rep(digit), (arr) => arr.join(''))
export const digits1 = map(rep1(digit), (arr) => arr.join(''))

export const space = alt(lit(' '), lit('\n'), lit('\t'));
export const spaces = rep(space);
export const spaces1 = rep1(space);

export const eps = lit('');

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
export const dot = key('.');

export const name = map(seq(letter, rep(alt(letter, digit))), ([start, chars]) => start + chars.join(''));
export const sym = map(seq(spaces, rep1(alt(...[...'!@#%~^&*-+=/?'].map(char => lit(char)))), spaces), ([, x]) => x.join(''));