import { Type, infer, Cons, Lam, formatType, fresh, Num, Str, TLam } from './src/type';
import { expr, format } from './src/expr';
import { mapValues } from './src/utils';

const add: TLam = Lam(Num, Num, Num)
const concat: TLam = Lam(Str, Str, Str);
const asdf = fresh()
const singleton: TLam = Lam(asdf, { kind: 'cons', name: 'List', args: [asdf] })


const tv = fresh();
const getHello: TLam = { kind: 'lam', args: [{ kind: 'rec', record: { hello: Num }, rest: fresh() }], result: Num }
const getBar: TLam = { kind: 'lam', args: [{ kind: 'rec', record: { bar: tv }, rest: fresh() }], result: tv }
const getBaz: TLam = { kind: 'lam', args: [{ kind: 'rec', record: { baz: Str }, rest: fresh() }], result: Str }

const e = expr('(\\x -> {hello: @add(@getHello(x), @getBar(x)), baz: @getBaz(x)})')[0];

const [subst, t] = infer(e)({ add, concat, getHello, getBar, getBaz });

console.log({ e: format(e), subst: mapValues(subst, formatType), t: formatType(t) })