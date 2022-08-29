import { Expr, expr } from './expr';
import { parse } from './parser';
import { repl } from './repl';

// const ast = parse(expr, '\\x -> `hello{x}world`');

// const result = evaluate(ast)({
//     space: ' ',
//     add: (x: any, y: any) => {
//         console.log({ x, y })
//         return x + y
//     }
// });


repl()