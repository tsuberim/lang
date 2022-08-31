import { cons, expr, Expr, Id, id, str, strPart } from './expr';
import { key, map, equal, seq, Parser, Span, bet, lcurly, rcurly, sep, comma, parseFile, rep, newline, alt, lit, parse, spaces, spaces1 } from './parser';
import fs from 'fs-extra';
import { evaluate, Value, VNum, VRec } from './value';
import { Context, filterValues, mapValues } from './utils';
import { applySubst, infer, Lam, Num, Type } from './type';

export type Import = { type: 'import', span: Span, path: string, imports: Id[] }
export type Assignment = { type: 'assignment', span: Span, id: Id, expr: Expr }

export type Item = Import | Assignment;
export type Module = { type: 'module', span: Span, items: Item[] };

export const importStatement: Parser<Import> = map(seq(key('import'), bet(lcurly, sep(id, comma), rcurly), key('from'), id), ([, imports, , path], span) => ({ type: 'import', span, imports, path: `./${path.name}.lang` }))
export const assignment: Parser<Assignment> = map(seq(id, equal, expr), ([id, , expr], span) => ({ type: 'assignment', span, id, expr }));
export const item = alt<Item>(importStatement, assignment)

export const module: Parser<Module> = map(sep(alt<Item>(importStatement, assignment), spaces1), (items, span) => ({ type: 'module', span, items }))

export async function evaluateModule(mod: Module): Promise<Context<[Value, Type]>> {
    const { items } = mod;
    const out: Context<[Value, Type]> = {};
    for (const item of items) {
        if (item.type === 'import') {
            const imp = await evaluateImport(item);
            Object.assign(out, imp)
        } else if (item.type === 'assignment') {
            const { id: { name }, expr } = item;
            const [subst, t] = infer(expr)(mapValues(out, x => x[1]));
            const val = evaluate(expr)(mapValues(out, x => x[0]));
            out[name] = [val, t]
        }
    }
    return out
}

export const std: Context<[Value, Type]> = {
    ['+']: [((x: VNum, y: VNum) => x + y) as Value, Lam(Num, Num, Num)],
};

export async function evaluateImport(imp: Import): Promise<Context<[Value, Type]>> {
    const { path, imports } = imp;
    if (path === './std.lang') {
        return filterValues(std, (v, k) => imports.map(x => x.name).includes(k))
    }
    const source = await fs.readFile(path, 'utf-8');
    const mod = parse(module, source);
    const rec = await evaluateModule(mod);
    return filterValues(rec, (v, k) => imports.map(x => x.name).includes(k));
}