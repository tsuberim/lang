import { fresh, Lam, List, Num, Str, Type } from './type';
import { Context } from './utils';
import { VNum, Value, VLst, VRec } from './value';

const t = fresh();

export const context = {
    ['+']: [(x: VNum, y: VNum) => x + y, Lam(Num, Num, Num)],
    ['^']: [(x: VNum, y: VNum) => x + y, Lam(Str, Str, Str)],
    ['++']: [(x: VLst, y: VLst) => [...x, ...y], Lam(List(t), List(t), List(t))],
} as Context<[Value, Type]>
