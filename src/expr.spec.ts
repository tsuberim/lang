import { deepStrictEqual } from 'assert';
import { assert, property, record, integer, string, Arbitrary, constant, oneof, array, float, tuple, letrec, context, dictionary, } from 'fast-check';
import { App, expr, Expr, format, Id, Lam, Lit, Rec, Str, strPartPatern as strPartPattern } from './expr';
import { end, namePattern, parse } from './parser';

function ending(regex: RegExp) {
    return new RegExp(regex.source + '$')
}

export const { expr: arbExpr } = letrec(tie => {
    const expr = tie('expr') as Arbitrary<Expr>;

    const name = string({ minLength: 1 }).filter(x => !!x.match(ending(namePattern)));
    const strPart = string({ minLength: 1 }).filter(x => !!x.match(ending(strPartPattern)))

    const lit = record<Lit>({ type: constant('lit'), value: oneof(integer({ min: 0 })) })
    const str = record<Str>({
        type: constant('str'), parts: array(oneof(strPart, expr)).map(arr => {
            const out = [];
            let acc = '';
            while (arr.length) {
                const item = arr.shift();
                if (typeof item === 'string') {
                    acc += item;
                } else {
                    if (acc !== '') {
                        out.push(acc);
                    }
                    out.push(item);
                    acc = '';
                }
            };
            if (acc !== '') {
                out.push(acc);
            }
            return out as any;
        })
    })
    const rec = record<Rec>({ type: constant('rec'), record: dictionary(name, expr) })
    const id = record<Id>({ type: constant('id'), name })
    const app = record<App>({ type: constant('app'), fn: expr, args: array(expr) })
    const lam = record<Lam>({ type: constant('lam'), args: array(id), body: expr })

    return { expr: oneof(lit, str, rec, id, app, lam) }
});

it('format is inverse to parse', () => assert(property(arbExpr, context(), (ast, ctx) => {
    const text = format(ast);
    ctx.log(text)
    const newAst = parse(expr, text);
    ctx.log(format(newAst))
    return deepStrictEqual(ast, newAst)
}))).timeout