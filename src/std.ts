import { Cons, fresh, Lam, List, Num, Str, TRec, Type, Unit, Void } from './type';
import { Context } from './utils';
import { VNum, Value, VLst, VRec, VStr, VClo, VUnit, tag, VTag, tagName, formatValue, eq } from './value';
import fs from 'fs';

const t = fresh();
const k = fresh();
const e = fresh();

const Bool: TRec = {kind: 'rec', union: true, open: false, items: {['True']: Unit, ['False']: Unit}, rest: fresh()}

const Task = (t: Type, e: Type) => Cons('Task', t, e);
const Result = (t: Type, e: Type) => Cons('Result', t, e);

const ok = (value: Value) => tag('Ok', value)
const err = (value: Value) => tag('Err', value)

export type Task<T = Value> = (cb: (tag: VTag) => T) => VUnit

function readFile(path: string): Task {
    return (cb) => {
        fs.readFile(path, 'utf-8', (err, str) => {
            if (err) {
                cb(tag('Err', err.message))
            } else {
                cb(tag('Ok', str))
            }
        })
        return null;
    }
}

function writeFile(path: string, content: string): Task {
    return (cb) => {
        fs.writeFile(path, content, 'utf-8', (err) => {
            if (err) {
                cb(tag('Err', err.message))
            } else {
                cb(tag('Ok', null))
            }
        })
        return null;
    }
}

function print(str: string): Task<VUnit> {
    return (cb) => {
        console.log(str);
        cb(ok(null));
        return null;
    }
}

function bind(task: Task, cont: (value: Value) => Task): Task {
    return (cb) => {
        task((val) => {
            const name = tagName(val);
            if (name === 'Ok') {
                const t = cont(val.value || {});
                t(cb);
            } else {
                cb(val)
            }
            return null;
        });
        return null;
    }
}

function map(list: VLst, fn: VClo) {
    return list.map(fn);
}

export async function runTask(task: Task): Promise<Value> {
    return new Promise((res, rej) => task(val => {
        const name = tagName(val);
        if (name === 'Ok') {
            res(val.value || {});
        } else {
            rej(val.value)
        };
        return null;
    }))
}

function index(x: VLst, y: VNum) {
    const idx = Math.floor(y) % x.length;
    return x[idx < 0 ? idx + x.length : idx]
}

function fold(list: VLst, op: VClo, seed: Value) {
    let acc = seed;
    for(const item of list.reverse()) {
        acc = op(item, acc)
    }
    return acc;
}

export const context = {
    ['eq']: [(x: Value, y: Value) => eq(x)(y) ? tag('True') : tag('False'), Lam(t, t, Bool)],
    ['+']: [(x: VNum, y: VNum) => x + y, Lam(Num, Num, Num)],
    ['*']: [(x: VNum, y: VNum) => x * y, Lam(Num, Num, Num)],
    ['^']: [(x: VNum, y: VNum) => x + y, Lam(Str, Str, Str)],
    ['@']: [index, Lam(List(t), Num, t)],
    ['toStr']: [(n: VNum) => `${n}`, Lam(Num, Str)],
    ['split']: [(str: string, delimiter: string) => str.split(delimiter), Lam(Str, Str, List(Str))],
    ['join']: [(str: string[], delimiter: string) => str.join(delimiter), Lam(List(Str), Str, Str)],
    ['length']: [(str: string) => str.length, Lam(Str, Num)],
    ['size']: [(vals: Value[]) => vals.length, Lam(List(t), Num)],
    ['++']: [(x: VLst, y: VLst) => [...x, ...y], Lam(List(t), List(t), List(t))],
    ['fold']: [fold, Lam(List(t), Lam(t, t, k), t, List(k))],
    ['map']: [map, Lam(List(t), Lam(t, k), List(k))],
    ['readFile']: [readFile, Lam(Str, Task(Str, Void))],
    ['writeFile']: [writeFile, Lam(Str, Str, Task(Unit, Void))],
    ['print']: [print, Lam(Str, Task(Unit, Void))],
    ['&>']: [bind, Lam(Task(t, e), Lam(t, Task(k, e)), Task(k, e)),]
} as Context<[Value, Type]>
