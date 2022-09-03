import { cons, Expr, expr, format } from "./expr";
import { createInterface } from 'readline';
import { parse, alt, map, spaces, lowerName, seq, lit, opt } from "./parser";
import { apply, applyToType, compose, formatScheme, formatType, fresh, generalize, infer, inferScheme, instantiate, Scheme, TRec, TypeEnv, unify } from "./type";
import { mapValues } from "./utils";
import { evaluate, formatValue, VClo, VRec } from "./value";
import chalk from "chalk";
import { runModule, toWasm, WatEmitter } from "./wasm";
import { evaluateImport, Item, item } from "./module";
import { context as std, runTask, Task } from './std';
import dedent from "dedent";
import { table } from "table";

export type Nothing = { type: 'nothing' };
export type Evaluate = { type: 'evaluate', expr: Expr };
export type MetaCommand = { type: 'meta', name: string, expr?: Expr };

export type Command = Nothing | Evaluate | Item | MetaCommand;

export const command = alt<Command>(
    map(seq(lit('!'), lowerName, opt(expr)), ([, name, expr]) => ({ type: 'meta', name, expr })),
    item,
    map(expr, expr => ({ type: 'evaluate', expr })),
    map(spaces, _ => ({ type: 'nothing' })),
);

export async function repl() {
    const rl = createInterface(process.stdin, process.stdout);

    const valueContext = mapValues(std, x => x[0]);
    const typeContext: TypeEnv = mapValues(std, x => generalize(x[1]));

    const helps: string[] = [
        chalk`We can use the {green.bold !exit} command to exit from the REPL (read, evaluate, print, loop)`,
        chalk`We can use the {green.bold !clear} command to clear the screen`,
        chalk`There are {bold.magenta numbers}, try: {yellow.italic 42}`,
        chalk`There are {bold.magenta strings}, try: {yellow.italic 'hello'}`,
        chalk`We can use assignment to name an expression, try {yellow.bold x = 42 + 1}`,
        chalk`We can use that name later, try {yellow.bold x + 4}`,
        chalk`We can use the {green.bold !context} command to show our available names`,
        chalk`There are {bold.magenta lists}, try: {yellow.italic [1,2,3]}`,
        chalk`Lists are {bold homogenous}, i.e. all items must be the same type, try: {yellow.italic [1,'hello',3]}`,
        chalk`Every expression has a type that is automatically {bold inferred}, try: {yellow.italic \\(x,y) -> x + y}`,
        chalk`Whats the type of this expression {yellow.italic \\x -> x} ?`,
        `There are records, try ${chalk.yellow.italic(`{name: 'John', age: 23}`)}`,
        `You can invent a new type consturctor by using an ${chalk.bold('uppercase')} name, try: ${chalk.yellow.italic(`Person({name: 'John', age: 23})`)}`,
        `This is called a ${chalk.bold('tag')}, tags allow us to make a union of types, try: ${chalk.yellow.italic(`[Person({name: 'John', age: 23}), Baby]`)}`,
        `Whats the type of this expression ${chalk.yellow.bold('[\\x -> x.bar, \\x -> x.foo]')} ?`,
        chalk`We can use a {magenta.bold when} expression to match on a value, try: {yellow.bold when Hot(Very) is Hot(x) -> x else Not}`,
        chalk`END (starting over...)`
    ];
    let helpIdx = 0;
    const commands: { [key: string]: (expr?: Expr) => Promise<any> | any } = {
        clear() { console.clear() },
        help() {
            console.log(
                dedent`
                    Welcome to ${chalk.magenta.bold('fun@' + require('../package.json').version)}!
                    ${chalk.magenta.bold('fun')} is a ${chalk.bold(`purly-${chalk.magenta.bold('fun')}ctional`)}, ${chalk.bold('statically-typed')} language that I wrote for ${chalk.italic('fun')}.

                    This is a small tutorial guiding you through the language.
                    (type ${chalk.italic.bold('!next')} / ${chalk.italic.bold('!prec')} to navigate the tutorial, use ${chalk.italic.bold('!reset')} to get back to the start)
                `
            )
        },
        next() {
            console.log(`${helpIdx + 1})`, helps[helpIdx]);
            helpIdx = (helpIdx + 1 + helps.length) % helps.length;
        },
        prev() {
            console.log(`${helpIdx + 1})`, helps[helpIdx]);
            helpIdx = (helpIdx - 1 + helps.length) % helps.length;
        },
        type(expr?: Expr) {
            const [, t] = infer(expr!)(typeContext);
            console.log(formatType(t));
        },
        async compile(ast?: Expr) {
            const emitter = new WatEmitter();
            const wat = emitter.compile(ast!);
            console.log(wat);
            const wasm = await toWasm(wat);
            console.log(wasm);
            const result = await runModule(wasm);
            console.log(result)
        },
        context() {
            const entries = Object.entries(typeContext).map(([name, type]) => [name, valueContext[name] ? formatValue(valueContext[name]) : chalk.red('undefined'), formatScheme(type)])
            console.log(table([['name', 'value', 'type'], ...entries]))
        }
    }

    commands.help();
    while (true) {
        let text: string = await new Promise(res => rl.question(chalk.gray('> '), res));
        try {
            let run = false;
            if(text.startsWith('!run ')) {
                text = text.replace('!run ', '');
                run = true;
            }
            const cmd = parse(command, text);
            if (cmd.type === 'assignment' || cmd.type === 'evaluate') {
                const expression = cmd.type === 'assignment' ? cmd.expr : cmd.expr;
                const name = cmd.type === 'assignment' ? cmd.id.name : undefined;
                let scheme = inferScheme(expression, typeContext);

                let value = evaluate(expression)(valueContext);
                if (run && scheme.type.kind === 'cons' && scheme.type.name === 'Task') {
                    value = await runTask(value as Task);
                    scheme.type = scheme.type.args[0];
                }
                if (name) {
                    if (typeContext[name]) {
                        const subst = unify(typeContext[name].type, scheme.type);
                        typeContext[name] = generalize(applyToType(subst, scheme.type))
                    } else {
                        typeContext[name] = scheme;
                    }
                    valueContext[name] = value;
                }
                if (value !== null) {
                    console.log(chalk`${formatValue(value)} {gray :} ${formatScheme(scheme)}`)
                }
            } if (cmd.type === 'decleration') {
                const { id: { name }, expr: type } = cmd;
                if (typeContext[name]) {
                    const subst = unify(instantiate(typeContext[name]), type);
                    typeContext[name] = generalize(applyToType(subst, type))
                } else {
                    typeContext[name] = generalize(type);
                }
            } else if (cmd.type === 'import') {
                const out = await evaluateImport(cmd);
                const rec: VRec = mapValues(out, x => x[0]);
                const types = mapValues(out, x => x[1])
                Object.assign(valueContext, rec)
                Object.assign(typeContext, types)

                const trec: Scheme = generalize({kind: 'rec', union: false, open: false, items: mapValues(types, instantiate), rest: fresh()});

                console.log(chalk`${formatValue(rec)} {gray :} ${formatScheme(trec)}`)
            } else if (cmd.type === 'meta') {
                const { name, expr } = cmd;
                if (name === 'exit') {
                    break;
                }
                const run = commands[name];
                if (!run) {
                    throw new Error(`Unknown command ${name}`);
                } else {
                    await run(expr);
                }
            } else if (cmd.type === 'nothing') {
                // skip
            }
        } catch (e) {
            console.error(chalk.red('ERROR: '), e.stack);
        }
    };

    rl.close();
}