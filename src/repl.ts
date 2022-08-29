import { expr, format, id } from "./expr";
import { createInterface } from 'readline';
import { parse, seq, end, map, key, opt } from "./parser";
import { Cons, formatType, fresh, infer, Lam, Num, Type } from "./type";
import { mapValues, Context } from "./utils";
import { evaluate, formatValue, Value, VLst, VNum } from "./value";
import chalk from "chalk";
import { WatEmitter } from "./wasm";

const equals = key('=');
const fullExpr = map(seq(expr, end), ([x]) => x);
const assignment = seq(opt(map(seq(id, equals), ([x]) => x.name)), fullExpr);

export async function repl() {
    const rl = createInterface(process.stdin, process.stdout);

    const t = fresh();
    const context: Context<[Value, Type]> = {
        add: [((x: VNum, y: VNum) => (x + y) as VNum) as Value, Lam(Num, Num, Num)],
        concat: [((x: VLst, y: VLst) => [...x, ...y]) as Value, Lam(Cons('List', t), Cons('List', t), Cons('List', t))],
        nil: [[], Cons('List', t)],
        cons: [((x: Value, tail: VLst) => [x, ...tail]) as Value, Lam(t, Cons('List', t), Cons('List', t))],
        head: [((lst: VLst) => lst[0]) as Value, Lam(Cons('List', t), t)],
        tail: [((lst: VLst) => lst.slice(1)) as Value, Lam(Cons('List', t), Cons('List', t))],
        ['-']: [((n: VNum) => -n) as Value, Lam(Num, Num)],
    };
    context['+'] = context['add']
    context['++'] = context['concat']

    const valueContext = mapValues(context, x => x[0]);
    const typeContext = mapValues(context, x => x[1]);

    while (true) {
        const text: string = await new Promise(res => rl.question(chalk.gray('lang> '), res));
        try {
            if (text.startsWith('!type ')) {
                const arg = text.replace('!type ', '').trim()
                console.log(formatType(typeContext[arg]));
            } else if (text.trim() === '!values') {
                console.log(Object.entries(valueContext).map(([name, val]) => chalk`${name}\t{gray =}\t${formatValue(val)}`).join('\n'))
            } else if (text.trim() === '!types') {
                console.log(Object.entries(typeContext).map(([name, type]) => chalk`${name}\t{gray ::}\t${formatType(type)}`).join('\n'))
            } else if (text.trim() === '!exit') {
                break;
            } else if (text.trim() === '!clear') {
                console.clear()
            } else if(text.startsWith('!compile ')) {
                const source = text.replace('!compile ', '').trim();
                const ast = parse(expr, source);
                const emitter = new WatEmitter();
                const wat = emitter.compile(ast);
                console.log(wat)
            } else {
                const [name, ast] = parse(assignment, text);
                console.log(format(ast))
                const [c, type] = infer(ast)(typeContext);
                const value = evaluate(ast)(valueContext);
                if (name) {
                    valueContext[name] = value;
                    typeContext[name] = type
                }
                console.log(chalk`${formatValue(value)} {gray ::} ${formatType(type)}`)
            }
        } catch (e) {
            console.error(chalk.red('ERROR: '), e.message);
        }
    };

    rl.close();
}