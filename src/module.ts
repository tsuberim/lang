import chalk from 'chalk';
import { expr, Expr, format, Id, id } from './expr';
import { key, map, equal, seq, alt, rep1, sep1, newline, Parser, upperName, Span } from './parser';
import { formatType, TCons, TId, TRec, type, Type } from './type';

export type Assignment = { type: 'assignment', span: Span, id: Id, expr: Expr }
export type TypeAlias = { type: 'alias', span: Span, name: string, expr: Type }
export type Item = Assignment | TypeAlias;
export type Module = Item[];

export const assignment: Parser<Assignment> = map(seq(id, equal, expr), ([id, , expr], span) => ({ type: 'assignment', span, id, expr }));
export const typeAlias: Parser<TypeAlias> = map(seq(key('type'), upperName, equal, type), ([, name, , type], span) => ({ type: 'alias', span, name, expr: type }))

export const item: Parser<Item> = alt<Item>(assignment, typeAlias);

export const module: Parser<Module> = sep1(item, newline);

export interface ItemWalker<T> {
    assignment(t: Assignment): T,
    typeAlias(t: TypeAlias): T,
}

export function walkItem<T>(walker: ItemWalker<T>) {
    const f = (item: Item): T => {
        if (item.type === 'assignment') {
            return walker.assignment(item);
        } else if (item.type === 'alias') {
            return walker.typeAlias(item);
        } else {
            throw new Error(`Impossible`)
        }
    }
    return f;
}

export const formatItem = walkItem({
    assignment: ({id, expr}) => chalk`${format(id)} = ${format(expr)}`,
    typeAlias: ({name, expr}) => `type ${name} = ${formatType(expr)}`
})