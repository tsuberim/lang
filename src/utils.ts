export type Context<T> = { [name: string]: T };

export function assertEq(actual: any, expected: any) {
    const strA = JSON.stringify(actual, undefined, 2);
    const strB = JSON.stringify(expected, undefined, 2);

    if (strA !== strB) {
        throw new Error(`Expected ${strB}, got: ${strA}`)
    }
}

export function throws(thunk: () => any) {
    try {
        thunk();
        throw new Error(`Expected to throw`)
    } catch (e) { }
}

export function trace<T>(tag: string, val: T): T {
    console.log(tag, val)
    return val
}

export function mapValues<A, B>(obj: { [key: string]: A }, f: (a: A, k: string) => B): { [key: string]: B } {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, f(v, k)]))
}

export function filterValues<A>(obj: { [key: string]: A }, f: (a: A, k: string) => boolean): { [key: string]: A } {
    return Object.fromEntries(Object.entries(obj).filter(([k, v]) => f(v, k)))
}


export function isUppercase(str: string) {
    return str[0].toUpperCase() === str[0];
}