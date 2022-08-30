import { walkExpr, Expr, Id } from './expr';
import { infer, Type } from './type';
import dedent from 'dedent';

export class WatEmitter {
    #compile = walkExpr<string>({
        lit: ({ value }) => dedent`i32.const ${value}`,
        str: (_, parts) => dedent`unreachable`,
        rec: (_, record) => dedent`unreachable`,
        acc: ({ name }, e) => dedent`unreachable`,
        list: (_, values) => dedent`unreachable`,
        id: ({ name }) => dedent`get_local $${name}`,
        app: (e, fn, args) => {
            const t = this.type(args.length);
            return `
                ${args.join('\n')}
                ${fn}
                call_indirect ${t}
            `
        },
        lam: ({ args }, body) => {
            this.functions.push({ body, args })
            return `i32.const ${this.functions.length - 1}`
        }
    });

    types: { [key: string]: string } = {};
    type(count: number) {
        const name = `$tf${count}`;
        this.types[name] = `(func (param ${new Array(count).fill(0).map(_ => `i32`).join(' ')}) (result i32))`;
        return name
    }
    functions: { body: string, args: Id[] }[] = []

    compile(expr: Expr): string {
        const [x, type] = infer(expr)({})
        const code = this.#compile(expr);
        return dedent`
            (module
                (table ${this.functions.length} anyfunc)
                ${this.functions.map(({ body, args }, i) => `
                    (func $f${i} ${args.map(({ name }, i) => `(param $${name} i32)`).join(' ')} (result i32)
                        ${body}
                    )
                `).join('\n')}
                (elem (i32.const 0) ${new Array(this.functions.length).fill(0).map((_, i) => `$f${i}`).join(' ')})
                ${Object.entries(this.types).map(([name, body]) => `(type ${name} ${body})`)}
                (func (export "main") (result i32)
                    ${code}
                )
            )
        `
    }
}

export async function toWasm(wast: string): Promise<Uint8Array> {
    const wasm2wasm = require('wast2wasm')
    const { buffer, log } = await wasm2wasm(wast, true);
    return buffer;
}

export async function runModule(buffer: Uint8Array): Promise<number> {
    const { instance } = await WebAssembly.instantiate(buffer);
    return (instance.exports as any).main();
}