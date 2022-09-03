import fs, { ReadStream } from 'fs';
import { Readable } from 'stream';
import chalk from 'chalk';

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
            const chunk: string = this.readable.read(more);
            if (chunk) {
                this.acc += chunk;
            }
        }
        return this.acc.slice(from, to);
    }
}

export class Source {
    static END = '\x00';
    static INDENT = '\x01';
    static DEDENT = '\x02';

    constructor(private str: BufferedString, public pos: Pos = { chars: 0, line: 0, column: 0, indent: 0 }) { }

    skip(n: number): Source {
        const str = this.peek(n);
        let { chars, line, column, indent } = { ...this.pos };
        for (const char of str) {
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

export class ParseError extends Error {
    constructor(source: Source, msg: string) {
        super(`ParseError: '${chalk.bold(source.peek(20))}...' (${formatPos(source.pos)}) - ${msg}`)
    }
}

export type Parser<T> = ((input: Source) => [T, Source]) & { displayName?: string };

export function displayName<T>(parser: Parser<T>): string {
    return parser.displayName || '<unnamed>';
}

export function named<T>(name: string, parser: Parser<T>, msg?: string): Parser<T> {
    const f = (input: Source) => {
        if (msg) {
            try {
                return parser(input);
            } catch (e) {
                throw new ParseError(input, msg)
            }
        } else {

            return parser(input);
        }
    };
    f.displayName = name
    return f
}

export function parse<T>(parser: Parser<T>, input: string): T {
    return map(seq(parser, end), ([x]) => x)(new Source(new BufferedString(ReadStream.from(input))))[0];
}

export function matches<T>(parser: Parser<T>, input: string): boolean {
    try {
        parse(parser, input);
        return true;
    } catch (e) {
        return false;
    }
}

export function parseFile<T>(parser: Parser<T>, path: string): T {
    return map(seq(parser, end), ([x]) => x)(new Source(new BufferedString(fs.createReadStream(path, 'utf-8'))))[0];
}

export function lit(str: string): Parser<string> {
    return named(str, (input) => {
        const start = input.peek(str.length);
        if (start.startsWith(str)) {
            return [input.peek(str.length), input.skip(str.length)]
        } else {
            throw new ParseError(input, `Expected literal '${str}'`);
        }
    })
}

export function map<T, K>(parser: Parser<T>, fn: (t: T, span: Span) => K): Parser<K> {
    return named(parser.displayName || '<unnamed>', (input) => {
        const [result, rest] = parser(input);
        return [fn(result, [input.pos, rest.pos]), rest];
    })
}

export function range(from: string, to: string): Parser<string> {
    return named(`[${from}-${to}]`, source => {
        const char = source.peek(1);
        if (from <= char && char <= to) {
            return [char, source.skip(1)]
        } else {
            throw new ParseError(source, `Expected a char between ${from} and ${to}`)
        }
    })
}

export function notChar(...chars: string[]): Parser<string> {
    const chs = [...chars, Source.END, Source.INDENT, Source.DEDENT]
    return named(`[^${chars.join('')}]`, source => {
        const char = source.peek(1);
        if (!chs.includes(char)) {
            return [char, source.skip(1)]
        } else {
            throw new ParseError(source, `Expected a char not from: [${chars.join(',')}]`)
        }
    })
}


export function seq<ARGS extends any[]>(...parsers: { [T in keyof ARGS]: Parser<ARGS[T]> }): Parser<ARGS> {
    return named('<' + parsers.map(p => p.displayName).join('•') + '>', (input: Source) => {
        const out: any[] = [];
        for (const parser of parsers) {
            const [parsed, rest] = parser(input);
            input = rest;
            out.push(parsed);
        }
        return [out as any, input];
    })
}

export function alt<T>(...parsers: Parser<T>[]): Parser<T> {
    return named('<' + parsers.map(p => p.displayName).join('|') + '>', (input) => {
        const errs = [];
        for (const parser of parsers) {
            try {
                return parser(input);
            } catch (e) {
                errs.push(e);
            }
        }
        throw new ParseError(input, `No parser matched:\n\t${errs.map(e => e.message).join('\n\t')}`)
    })
}

export function rep<T>(parser: Parser<T>): Parser<T[]> {
    return named(parser.displayName + '*', (input) => {
        const out: T[] = [];
        try {
            while (true) {
                const [result, rest] = parser(input);
                input = rest;
                out.push(result)
            }
        } catch (e) { };
        return [out, input];
    })
}

export function rep1<T>(parser: Parser<T>): Parser<T[]> {
    return named(parser.displayName + '+', map(seq(parser, rep(parser)), ([t, arr]) => [t, ...arr]));
}


export function sep<T>(parser: Parser<T>, delimiter: Parser<any>): Parser<T[]> {
    return rep(alt(map(seq(parser, delimiter), ([x]) => x), parser));
}

export function sep1<T>(parser: Parser<T>, delimiter: Parser<any>): Parser<T[]> {
    return rep1(alt(map(seq(parser, delimiter), ([x]) => x), parser));
}

export function bet<T>(left: Parser<any>, parser: Parser<T>, right: Parser<any>): Parser<T> {
    return map(seq(left, parser, right), ([_, x]) => x);
}

export function opt<T>(parser: Parser<T>): Parser<T | undefined> {
    return alt(parser, map(eps, _ => undefined))
}

export function key(str: string) {
    return named(str, bet(spaces, lit(str), spaces));
}


export function delay<T>(thunk: () => Parser<T>): Parser<T> {
    const f = (input: Source) => {
        const parser = thunk();
        (f as any).displayName = parser.displayName;

        return parser(input);
    }
    return f;
}


export const end = named('END', lit(Source.END), `Expected END`);
export const indent = named('INDENT', lit(Source.INDENT), `Expected INDENT`);
export const dedent = named('DEDENT', lit(Source.DEDENT), `Expected DEDENT`);

export const lowercase = range('a', 'z');
export const uppercase = range('A', 'Z');
export const letter = alt(lowercase, uppercase);
export const letters = rep(letter);
export const letters1 = rep1(letter);

export const digit = range('0', '9');
export const digits = map(rep(digit), (arr) => arr.join(''))
export const digits1 = map(rep1(digit), (arr) => arr.join(''))

export const space = named('\\s', alt(lit(' '), lit('\n'), lit('\t')));
export const spaces = rep(space);
export const spaces1 = rep1(space);

export const eps = named('ε', (source) => [true, source]);

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
export const semicolon = key(';')
export const pipe = key('|');
export const backslash = key('\\');
export const at = key('@');
export const arrow = key('->');
export const dot = key('.');
export const equal = key('=');
export const newline = alt(key('\r\n'), key('\n'));

export const name = named('id', map(seq(letter, rep(alt(letter, digit))), ([start, chars]) => start + chars.join('')));
export const upperName = named('id', map(seq(uppercase, rep(alt(letter, digit))), ([start, chars]) => start + chars.join('')));
export const lowerName = named('id', map(seq(lowercase, rep(alt(letter, digit))), ([start, chars]) => start + chars.join('')));
export const sym = named('symbol', map(seq(spaces, rep1(alt(...[...'!@#%~^&*-+/><?|'].map(char => lit(char)))), spaces), ([, x]) => x.join('')));