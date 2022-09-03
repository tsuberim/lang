import { cons, expr, Expr, Id, id, str, strPart } from './expr';
import { key, map, equal, seq, Parser, Span, bet, lcurly, rcurly, sep, comma, parseFile, rep, newline, alt, lit, parse, spaces, spaces1, colon, newlines1 } from './parser';
import fs from 'fs-extra';
import { evaluate, Value, VNum, VRec } from './value';
import { Context, filterValues, mapValues } from './utils';
import { generalize, infer, inferScheme, Lam, Num, Scheme, type, Type } from './type';
import {context as std} from './std';

export type Import = { type: 'import', span: Span, path: string, imports: Id[] }
export type Assignment = { type: 'assignment', span: Span, id: Id, expr: Expr }
export type Decleration = { type: 'decleration', span: Span, id: Id, expr: Type }

export type Item = Import | Assignment | Decleration;
export type Module = { type: 'module', span: Span, items: Item[] };

export const importStatement: Parser<Import> = map(seq(key('import'), bet(lcurly, sep(id, comma), rcurly), key('from'), bet(lit(`'`), str, lit(`'`))), ([, imports, , path], span) => ({ type: 'import', span, imports, path: `./${path.value}.lang` }))
export const assignment: Parser<Assignment> = map(seq(id, equal, expr), ([id, , expr], span) => ({ type: 'assignment', span, id, expr }));
export const decleration: Parser<Decleration> = map(seq(id, colon, type), ([id, , expr], span) => ({ type: 'decleration', span, id, expr }));
export const item = alt<Item>(importStatement, assignment, decleration)

export const module: Parser<Module> = map(sep(alt<Item>(importStatement, assignment, decleration), newlines1), (items, span) => ({ type: 'module', span, items }))

export async function evaluateModule(mod: Module): Promise<Context<[Value, Scheme]>> {
    const { items } = mod;
    const out: Context<[Value, Scheme]> = {};
    for (const item of items) {
        if (item.type === 'import') {
            const imp = await evaluateImport(item);
            Object.assign(out, imp)
        } else if (item.type === 'assignment') {
            const { id: { name }, expr } = item;
            const t = inferScheme(expr, mapValues(out, x => x[1]));
            const val = evaluate(expr)(mapValues(out, x => x[0]));
            out[name] = [val, t]
        }
    }
    return out
}

export async function evaluateImport(imp: Import): Promise<Context<[Value, Scheme]>> {
    const { path, imports } = imp;
    if (path === './std.lang') {
        return filterValues(mapValues(std, ([v,t]) => [v, generalize(t)]), (v, k) => imports.map(x => x.name).includes(k))
    }
    const source = await fs.readFile(path, 'utf-8');
    const mod = parse(module, source);
    const rec = await evaluateModule(mod);
    return filterValues(rec, (v, k) => imports.map(x => x.name).includes(k));
}