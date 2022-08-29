import { walkExpr, Expr, Id } from './expr';
import { symPattern } from './parser';
import { infer, Type } from './type';
import dedent from 'dedent';

export class WatEmitter {
    #compile = walkExpr<string>({
        lit: ({ value }) => dedent`i32.const ${value}`,
        str: (_, parts) => dedent`unreachable`,
        rec: (_, record) => dedent`unreachable`,
        acc: ({ name }, e) => dedent`unreachable`,
        list: (_, values) => dedent`unreachable`,
        id: ({ name }) => dedent`local.get $${name}`,
        app: (e, fn, args) => {
            const t = this.type(args.length);
            return `
                ${args.join('\n')}
                ${fn}
                call_indirect (type ${t})
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

    compile(expr: Expr) {
        const [x, type] = infer(expr)({})
        const code = this.#compile(expr);
        return dedent`
            (module
                (table ${this.functions.length} funcref)
                ${this.functions.map(({ body, args }, i) => `
                    (func $f${i} ${args.map(({ name }, i) => `(param $${name} i32)`).join(' ')} (result i32)
                        ${body}
                    )
                `)}
                (elem (i32.const 0) ${new Array(this.functions.length).fill(0).map((_, i) => `$f${i}`).join(' ')})
                ${Object.entries(this.types).map(([name, body]) => `(type ${name} ${body})`)}
                (func (export "main") (result i32)
                    ${code}
                )
            )
        `
    }
}