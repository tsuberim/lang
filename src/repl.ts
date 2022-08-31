import { cons, Expr, expr, format } from "./expr";
import { createInterface } from 'readline';
import { parse, alt, map, spaces, lowerName, seq, lit, opt } from "./parser";
import { formatType, infer } from "./type";
import { mapValues } from "./utils";
import { evaluate, formatValue } from "./value";
import chalk from "chalk";
import { runModule, toWasm, WatEmitter } from "./wasm";
import { evaluateImport, Item, item } from "./module";
import { context as std } from './std';
import dedent from "dedent";

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
    const typeContext = mapValues(std, x => x[1]);

    const helps: string[] = [
        chalk`We can use the {green.bold !exit} command to exit from the RELP`,
        chalk`We can use the {green.bold !clear} command to clear the screen`,
        chalk`There are {bold.magenta numbers}, try: {yellow.italic 42}`,
        chalk`There are {bold.magenta strings}, try: {yellow.italic \`hello\`}`,
        chalk`We can use assignment to name an expression, try {yellow.bold x = 42 + 1}`,
        chalk`We can use that name later, try {yellow.bold x + 4}`,
        chalk`We can use the {green.bold !context} command to show our available names`,
        chalk`There are {bold.magenta lists}, try: {yellow.italic [1,2,3]}`,
        chalk`Lists are {bold homogenous}, i.e. all items must be the same type, try: {yellow.italic [1,\`hello\`,3]}`,
        chalk`Every expression has a type that is automatically {bold inferred}, try: {yellow.italic \\(x,y) -> x + y}`,
        `? Whats the type of this expression {yellow.italic \\x -> x}`,
        `There are records, try ${chalk.yellow.italic('{name: Str, age: Num}')}`,
        `You can invent a new type consturctor by using an ${chalk.bold('uppercase')} name, try: ${chalk.yellow.italic('Person({name: `John`, age: 23})')}`,
        `This is called a ${chalk.bold('tag')}, tags allow us to make a union of types, try: ${chalk.yellow.italic('[Person({name: `John`, age: 23}), Baby]')}`,
        `? Whats the type of this expression ${chalk.yellow.bold('[\\x -> x.bar, \\x -> x.foo]')}`,
        `We can use a {magenta.bold match} expression to match on a value, try: {yellow.bold match Hot(Very) when Hot(x) -> x when ignored -> Not}`,
        `END (starting over...)`
    ];
    let helpIdx = 0;
    const commands: { [key: string]: (expr?: Expr) => Promise<any> | any } = {
        clear() { console.clear() },
        help() {
            console.log(
                dedent`
                    Welcome to ${chalk.magenta.bold('mylang@' + require('../package.json').version)} (working title)!
                    ${chalk.magenta.bold('mylang')} is a ${chalk.bold('purly-functional')}, ${chalk.bold('statically-typed')} language that compiles to ${chalk.bold('WASM')}.

                    This is a small tutorial guiding you through the language.
                    (type ${chalk.italic.bold('!next')} / ${chalk.italic.bold('!prec')} to navigate the tutorial, use ${chalk.italic.bold('!reset')} to get back to the start)
                `
            )
        },
        next() {
            console.log(`${helpIdx + 1})`, helps[helpIdx]);
            helpIdx = (helpIdx + 1) % helps.length;
        },
        prev() {
            console.log(`${helpIdx + 1})`, helps[helpIdx]);
            helpIdx = (helpIdx - 1) % helps.length;
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
            return console.log(Object.entries(valueContext).map(([name, val]) =>
                chalk`${name}\t{gray =}\t${formatValue(val)}\t:\t${formatType(typeContext[name])}`
            ).join('\n'))
        }
    }

    commands.help();
    while (true) {
        const text: string = await new Promise(res => rl.question(chalk.gray('> '), res));
        try {
            const cmd = parse(command, text);
            if (cmd.type === 'assignment' || cmd.type === 'evaluate') {
                const expression = cmd.type === 'assignment' ? cmd.expr : cmd.expr;
                const name = cmd.type === 'assignment' ? cmd.id.name : undefined;
                const [c, type] = infer(expression)(typeContext);
                const value = evaluate(expression)(valueContext);
                if (name) {
                    valueContext[name] = value;
                    typeContext[name] = type
                }
                console.log(chalk`${formatValue(value)} {gray :} ${formatType(type)}`)
            } else if (cmd.type === 'import') {
                const out = await evaluateImport(cmd);
                const rec = mapValues(out, x => x[0]);
                const types = mapValues(out, x => x[1])
                Object.assign(valueContext, rec)
                Object.assign(typeContext, types)

                console.log(formatValue(rec));
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