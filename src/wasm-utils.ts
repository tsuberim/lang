export const unsignedLEB128 = (n: number) => {
    const buffer = [];
    do {
        let byte = n & 0x7f;
        n >>>= 7;
        if (n !== 0) {
            byte |= 0x80;
        }
        buffer.push(byte);
    } while (n !== 0);
    return buffer;
};

// https://webassembly.github.io/spec/core/binary/modules.html#sections
export enum Section {
    custom = 0,
    type = 1,
    import = 2,
    func = 3,
    table = 4,
    memory = 5,
    global = 6,
    export = 7,
    start = 8,
    element = 9,
    code = 10,
    data = 11
}

// https://webassembly.github.io/spec/core/binary/types.html
export enum Valtype {
    i32 = 0x7f,
    f32 = 0x7d
}

// https://webassembly.github.io/spec/core/binary/instructions.html
export enum Opcodes {
    end = 0x0b,
    get_local = 0x20,
    f32_add = 0x92
}

// http://webassembly.github.io/spec/core/binary/modules.html#export-section
export enum ExportType {
    func = 0x00,
    table = 0x01,
    mem = 0x02,
    global = 0x03
}

// http://webassembly.github.io/spec/core/binary/types.html#function-types
export const functionType = 0x60;

export const emptyArray = 0x0;

// https://webassembly.github.io/spec/core/binary/modules.html#binary-module
export const magicModuleHeader = [0x00, 0x61, 0x73, 0x6d];
export const moduleVersion = [0x01, 0x00, 0x00, 0x00];

// https://webassembly.github.io/spec/core/binary/conventions.html#binary-vec
// Vectors are encoded with their length followed by their element sequence
export const encodeVector = (data: any[]) => [
    unsignedLEB128(data.length),
    ...data.flat()
];

// https://webassembly.github.io/spec/core/binary/modules.html#sections
// sections are encoded by their type followed by their vector contents
export const createSection = (sectionType: Section, data: any[]) => [
    sectionType,
    ...encodeVector(data)
];

export const encodeString = (str: string) => [
    str.length,
    ...str.split("").map(s => s.charCodeAt(0))
];

export function createFunctionType(...types: Valtype[]) {
    const copy = [...types];
    const result = copy.pop();
    return [
        functionType,
        ...encodeVector(copy),
        ...encodeVector([result])
    ]
}

export function createFunction(code: any[]) {
    return encodeVector([
        emptyArray /** locals */,
        ...code,
        Opcodes.end
    ]);
}

export interface Function {
    type: Valtype[],
    code: number[],
    export?: boolean,
}

export const createModule = (functions: { [name: string]: Function }) => {
    const names = Object.keys(functions);
    const idxs = names.map((n, i) => i);
    const types = names.map(k => createFunctionType(...functions[k].type));
    const bodys = names.map(k => createFunction(functions[k].code));

    // the type section is a vector of function types
    const typeSection = createSection(
        Section.type,
        encodeVector(types)
    );

    // the function section is a vector of type indices that indicate the type of each function
    // in the code section
    const funcSection = createSection(
        Section.func,
        encodeVector(idxs)
    );

    // the export section is a vector of exported functions
    const exportSection = createSection(
        Section.export,
        encodeVector(names.filter(k => functions[k].export).map((name, i) => [...encodeString(name), ExportType.func, i /* function index */]))
    );

    const codeSection = createSection(Section.code, encodeVector(bodys));

    return Uint8Array.from([
        ...magicModuleHeader,
        ...moduleVersion,
        ...typeSection,
        ...funcSection,
        ...exportSection,
        ...codeSection
    ]);
};

async function main() {
    const functions = {
        run: {
            type: [Valtype.f32, Valtype.f32, Valtype.f32],
            code: [
                Opcodes.get_local,
                ...unsignedLEB128(0),
                Opcodes.get_local,
                ...unsignedLEB128(1),
                Opcodes.f32_add
            ],
            export: true,
        }
    };

    const wasm = createModule(functions);
    const { instance } = await WebAssembly.instantiate(wasm, {});
    console.log((instance.exports as any).run(1, 4))
}

main()