import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('VTracer WASM Core Audit & Direct Test', () => {
  it('deve instanciar o binário WASM do VTracer e vetorizar uma imagem de teste', async () => {
    const wasmPath = path.resolve(
      __dirname,
      '../node_modules/@visioncortex/vtracer/pkg/vtracer_wasm_bg.wasm'
    );
    const wasmBytes = fs.readFileSync(wasmPath);

    // Imports requeridos pelo wasm-bindgen do VTracer
    let wasm: any;
    let WASM_VECTOR_LEN = 0;
    const cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
    const cachedTextEncoder = new TextEncoder();

    function getStringFromWasm0(ptr: number, len: number) {
      return cachedTextDecoder.decode(new Uint8Array(wasm.memory.buffer).subarray(ptr, ptr + len));
    }

    function passArray8ToWasm0(arg: Uint8Array, malloc: any) {
      const ptr = malloc(arg.length * 1, 1) >>> 0;
      new Uint8Array(wasm.memory.buffer).set(arg, ptr / 1);
      WASM_VECTOR_LEN = arg.length;
      return ptr;
    }

    function passStringToWasm0(arg: string, malloc: any, realloc: any) {
      const buf = cachedTextEncoder.encode(arg);
      const ptr = malloc(buf.length, 1) >>> 0;
      new Uint8Array(wasm.memory.buffer).subarray(ptr, ptr + buf.length).set(buf);
      WASM_VECTOR_LEN = buf.length;
      return ptr;
    }

    const import0: any = {
      __proto__: null,
      __wbg_Error_92b29b0548f8b746: (arg0: number, arg1: number) => Error(getStringFromWasm0(arg0, arg1)),
      __wbg_Number_9a4e0ecb0fa16705: (arg0: any) => Number(arg0),
      __wbg_String_8564e559799eccda: (arg0: number, arg1: any) => {
        const ret = String(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const view = new DataView(wasm.memory.buffer);
        view.setInt32(arg0 + 4 * 1, len1, true);
        view.setInt32(arg0 + 4 * 0, ptr1, true);
      },
      __wbg___wbindgen_bigint_get_as_i64_d968e41184ae354f: (arg0: number, arg1: any) => {
        const v = arg1;
        const ret = typeof v === 'bigint' ? v : undefined;
        const view = new DataView(wasm.memory.buffer);
        view.setBigInt64(arg0 + 8 * 1, ret === undefined ? BigInt(0) : ret, true);
        view.setInt32(arg0 + 4 * 0, ret !== undefined ? 1 : 0, true);
      },
      __wbg___wbindgen_boolean_get_fa956cfa2d1bd751: (arg0: any) => (typeof arg0 === 'boolean' ? (arg0 ? 1 : 0) : 0xffffff),
      __wbg___wbindgen_debug_string_c25d447a39f5578f: (arg0: number, arg1: any) => {
        const ret = `${arg1}`;
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const view = new DataView(wasm.memory.buffer);
        view.setInt32(arg0 + 4 * 1, len1, true);
        view.setInt32(arg0 + 4 * 0, ptr1, true);
      },
      __wbg___wbindgen_in_aca499c5de7ff5e5: (arg0: any, arg1: any) => arg0 in arg1,
      __wbg___wbindgen_is_bigint_2f76dc55065b4273: (arg0: any) => typeof arg0 === 'bigint',
      __wbg___wbindgen_is_function_1ff95bcc5517c252: (arg0: any) => typeof arg0 === 'function',
      __wbg___wbindgen_is_null_ea9085d691f535d3: (arg0: any) => arg0 === null,
      __wbg___wbindgen_is_object_a27215656b807791: (arg0: any) => typeof arg0 === 'object' && arg0 !== null,
      __wbg___wbindgen_is_undefined_c05833b95a3cf397: (arg0: any) => arg0 === undefined,
      __wbg___wbindgen_jsval_eq_e659fcf7b0e32763: (arg0: any, arg1: any) => arg0 === arg1,
      __wbg___wbindgen_jsval_loose_eq_db4c3b15f63fc170: (arg0: any, arg1: any) => arg0 == arg1,
      __wbg___wbindgen_number_get_394265ed1e1b84ee: (arg0: number, arg1: any) => {
        const ret = typeof arg1 === 'number' ? arg1 : undefined;
        const view = new DataView(wasm.memory.buffer);
        view.setFloat64(arg0 + 8 * 1, ret === undefined ? 0 : ret, true);
        view.setInt32(arg0 + 4 * 0, ret !== undefined ? 1 : 0, true);
      },
      __wbg___wbindgen_string_get_b0ca35b86a603356: (arg0: number, arg1: any) => {
        const ret = typeof arg1 === 'string' ? arg1 : undefined;
        const ptr1 = ret === undefined ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const view = new DataView(wasm.memory.buffer);
        view.setInt32(arg0 + 4 * 1, len1, true);
        view.setInt32(arg0 + 4 * 0, ptr1, true);
      },
      __wbg___wbindgen_throw_344f42d3211c4765: (arg0: number, arg1: number) => {
        throw new Error(getStringFromWasm0(arg0, arg1));
      },
      __wbg_call_8a2dd23819f8a60a: (arg0: any, arg1: any) => arg0.call(arg1),
      __wbg_done_89b2b13e91a60321: (arg0: any) => arg0.done,
      __wbg_get_c7eb1f358a7654df: (arg0: any, arg1: any) => Reflect.get(arg0, arg1),
      __wbg_get_unchecked_6e0ad6d2a41b06f6: (arg0: any, arg1: number) => arg0[arg1 >>> 0],
      __wbg_get_with_ref_key_6412cf3094599694: (arg0: any, arg1: any) => arg0[arg1],
      __wbg_instanceof_ArrayBuffer_4480b9e0068a8adb: (arg0: any) => arg0 instanceof ArrayBuffer,
      __wbg_instanceof_Uint8Array_309b927aaf7a3fc7: (arg0: any) => arg0 instanceof Uint8Array,
      __wbg_isArray_0677c962b281d01a: (arg0: any) => Array.isArray(arg0),
      __wbg_isSafeInteger_04f36e4056f1b851: (arg0: any) => Number.isSafeInteger(arg0),
      __wbg_iterator_6f722e4a93058b71: () => Symbol.iterator,
      __wbg_length_1f0964f4a5e2c6d8: (arg0: any) => arg0.length,
      __wbg_length_370319915dc99107: (arg0: any) => arg0.length,
      __wbg_new_cd45aabdf6073e84: (arg0: any) => new Uint8Array(arg0),
      __wbg_next_6dbf2c0ac8cde20f: (arg0: any) => arg0.next,
      __wbg_next_71f2aa1cb3d1e37e: (arg0: any) => arg0.next(),
      __wbg_prototypesetcall_4770620bbe4688a0: (arg0: number, arg1: number, arg2: any) => {
        new Uint8Array(wasm.memory.buffer).subarray(arg0, arg0 + arg1).set(arg2);
      },
      __wbg_value_a5d5488a9589444a: (arg0: any) => arg0.value,
      __wbindgen_cast_0000000000000001: (arg0: number, arg1: number) => getStringFromWasm0(arg0, arg1),
      __wbindgen_cast_0000000000000002: (arg0: number) => BigInt.asUintN(64, BigInt(arg0)),
      __wbindgen_init_externref_table: () => {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
      },
    };

    const wasmModule = new WebAssembly.Module(wasmBytes);
    const wasmInstance = new WebAssembly.Instance(wasmModule, {
      './vtracer_wasm_bg.js': import0,
    });
    wasm = wasmInstance.exports;
    wasm.__wbindgen_start();

    // Cria um buffer RGBA 10x10 com um quadrado preto no centro
    const width = 10;
    const height = 10;
    const rgba = new Uint8Array(width * height * 4);
    // Preenche com branco
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
      rgba[i + 3] = 255;
    }
    // Quadrado preto central de (2,2) a (7,7)
    for (let y = 2; y <= 7; y++) {
      for (let x = 2; x <= 7; x++) {
        const idx = (y * width + x) * 4;
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 255;
      }
    }

    const ptr0 = passArray8ToWasm0(rgba, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.vectorize_rgba(ptr0, len0, width, height, { mode: 'spline', clustering: 'bw' });
    const svgResult = getStringFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1], 1);

    expect(svgResult).toContain('<svg');
    expect(svgResult).toContain('<path');
    expect(svgResult).toContain('d="M');
  });
});
