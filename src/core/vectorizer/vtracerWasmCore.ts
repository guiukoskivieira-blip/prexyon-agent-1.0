/**
 * Prexyon VTracer WASM Core Bindings
 *
 * Provê interface estrita e segura para invocar o binário WASM do VTracer
 * sem dependência de Node.js `fs` ou elementos DOM, funcionando em Web Workers e no cliente.
 */

export interface VTracerOptions {
  preset?: 'bw' | 'poster' | 'photo';
  clustering?: 'color-cluster' | 'bw' | 'watershed';
  hierarchical?: 'stacked' | 'cutout';
  mode?: 'pixel' | 'polygon' | 'spline';
  filterSpeckle?: number;
  colorPrecision?: number;
  layerDifference?: number;
  cornerThreshold?: number;
  lengthThreshold?: number;
  maxIterations?: number;
  spliceThreshold?: number;
  simplify?: number;
  pathPrecision?: number;
}

export class VTracerWasmInstance {
  private wasm: any = null;
  private wasmVectorLen: number = 0;
  private cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
  private cachedTextEncoder = new TextEncoder();

  public async init(wasmSource: ArrayBuffer | WebAssembly.Module | Response): Promise<void> {
    if (this.wasm) return;

    const importObject: any = {
      './vtracer_wasm_bg.js': this.getImports(),
    };

    let instance: WebAssembly.Instance;

    if (wasmSource instanceof WebAssembly.Module) {
      instance = await WebAssembly.instantiate(wasmSource, importObject);
    } else if (wasmSource instanceof Response) {
      const result = await WebAssembly.instantiateStreaming(wasmSource, importObject);
      instance = result.instance;
    } else {
      const result = await WebAssembly.instantiate(wasmSource, importObject);
      instance = result.instance;
    }

    this.wasm = instance.exports;
    if (this.wasm.__wbindgen_start) {
      this.wasm.__wbindgen_start();
    }
  }

  private getStringFromWasm(ptr: number, len: number): string {
    return this.cachedTextDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer).subarray(ptr, ptr + len)
    );
  }

  private passArray8ToWasm(arg: Uint8Array, malloc: any): number {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    new Uint8Array(this.wasm.memory.buffer).set(arg, ptr / 1);
    this.wasmVectorLen = arg.length;
    return ptr;
  }

  private passStringToWasm(arg: string, malloc: any, _realloc?: any): number {
    const buf = this.cachedTextEncoder.encode(arg);
    const ptr = malloc(buf.length, 1) >>> 0;
    new Uint8Array(this.wasm.memory.buffer).subarray(ptr, ptr + buf.length).set(buf);
    this.wasmVectorLen = buf.length;
    return ptr;
  }

  private getImports() {
    const self = this;
    return {
      __proto__: null,
      __wbg_Error_92b29b0548f8b746: (arg0: number, arg1: number) =>
        Error(self.getStringFromWasm(arg0, arg1)),
      __wbg_Number_9a4e0ecb0fa16705: (arg0: any) => Number(arg0),
      __wbg_String_8564e559799eccda: (arg0: number, arg1: any) => {
        const ret = String(arg1);
        const ptr1 = self.passStringToWasm(ret, self.wasm.__wbindgen_malloc, self.wasm.__wbindgen_realloc);
        const len1 = self.wasmVectorLen;
        const view = new DataView(self.wasm.memory.buffer);
        view.setInt32(arg0 + 4 * 1, len1, true);
        view.setInt32(arg0 + 4 * 0, ptr1, true);
      },
      __wbg___wbindgen_bigint_get_as_i64_d968e41184ae354f: (arg0: number, arg1: any) => {
        const v = arg1;
        const ret = typeof v === 'bigint' ? v : undefined;
        const view = new DataView(self.wasm.memory.buffer);
        view.setBigInt64(arg0 + 8 * 1, ret === undefined ? BigInt(0) : ret, true);
        view.setInt32(arg0 + 4 * 0, ret !== undefined ? 1 : 0, true);
      },
      __wbg___wbindgen_boolean_get_fa956cfa2d1bd751: (arg0: any) =>
        typeof arg0 === 'boolean' ? (arg0 ? 1 : 0) : 0xffffff,
      __wbg___wbindgen_debug_string_c25d447a39f5578f: (arg0: number, arg1: any) => {
        const ret = `${arg1}`;
        const ptr1 = self.passStringToWasm(ret, self.wasm.__wbindgen_malloc, self.wasm.__wbindgen_realloc);
        const len1 = self.wasmVectorLen;
        const view = new DataView(self.wasm.memory.buffer);
        view.setInt32(arg0 + 4 * 1, len1, true);
        view.setInt32(arg0 + 4 * 0, ptr1, true);
      },
      __wbg___wbindgen_in_aca499c5de7ff5e5: (arg0: any, arg1: any) => arg0 in arg1,
      __wbg___wbindgen_is_bigint_2f76dc55065b4273: (arg0: any) => typeof arg0 === 'bigint',
      __wbg___wbindgen_is_function_1ff95bcc5517c252: (arg0: any) => typeof arg0 === 'function',
      __wbg___wbindgen_is_null_ea9085d691f535d3: (arg0: any) => arg0 === null,
      __wbg___wbindgen_is_object_a27215656b807791: (arg0: any) =>
        typeof arg0 === 'object' && arg0 !== null,
      __wbg___wbindgen_is_undefined_c05833b95a3cf397: (arg0: any) => arg0 === undefined,
      __wbg___wbindgen_jsval_eq_e659fcf7b0e32763: (arg0: any, arg1: any) => arg0 === arg1,
      __wbg___wbindgen_jsval_loose_eq_db4c3b15f63fc170: (arg0: any, arg1: any) => arg0 == arg1,
      __wbg___wbindgen_number_get_394265ed1e1b84ee: (arg0: number, arg1: any) => {
        const ret = typeof arg1 === 'number' ? arg1 : undefined;
        const view = new DataView(self.wasm.memory.buffer);
        view.setFloat64(arg0 + 8 * 1, ret === undefined ? 0 : ret, true);
        view.setInt32(arg0 + 4 * 0, ret !== undefined ? 1 : 0, true);
      },
      __wbg___wbindgen_string_get_b0ca35b86a603356: (arg0: number, arg1: any) => {
        const ret = typeof arg1 === 'string' ? arg1 : undefined;
        const ptr1 = ret === undefined ? 0 : self.passStringToWasm(ret, self.wasm.__wbindgen_malloc, self.wasm.__wbindgen_realloc);
        const len1 = self.wasmVectorLen;
        const view = new DataView(self.wasm.memory.buffer);
        view.setInt32(arg0 + 4 * 1, len1, true);
        view.setInt32(arg0 + 4 * 0, ptr1, true);
      },
      __wbg___wbindgen_throw_344f42d3211c4765: (arg0: number, arg1: number) => {
        throw new Error(self.getStringFromWasm(arg0, arg1));
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
        new Uint8Array(self.wasm.memory.buffer).subarray(arg0, arg0 + arg1).set(arg2);
      },
      __wbg_value_a5d5488a9589444a: (arg0: any) => arg0.value,
      __wbindgen_cast_0000000000000001: (arg0: number, arg1: number) => self.getStringFromWasm(arg0, arg1),
      __wbindgen_cast_0000000000000002: (arg0: number) => BigInt.asUintN(64, BigInt(arg0)),
      __wbindgen_init_externref_table: () => {
        const table = self.wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
      },
    };
  }

  public vectorizeRgba(
    rgba: Uint8Array,
    width: number,
    height: number,
    options: VTracerOptions = {}
  ): string {
    if (!this.wasm) throw new Error('VTracer WASM não inicializado.');

    const ptr0 = this.passArray8ToWasm(rgba, this.wasm.__wbindgen_malloc);
    const len0 = this.wasmVectorLen;
    const ret = this.wasm.vectorize_rgba(ptr0, len0, width, height, options);
    const svgResult = this.getStringFromWasm(ret[0], ret[1]);
    this.wasm.__wbindgen_free(ret[0], ret[1], 1);
    return svgResult;
  }

  public vectorizeBytes(data: Uint8Array, options: VTracerOptions = {}): string {
    if (!this.wasm) throw new Error('VTracer WASM não inicializado.');

    const ptr0 = this.passArray8ToWasm(data, this.wasm.__wbindgen_malloc);
    const len0 = this.wasmVectorLen;
    const ret = this.wasm.vectorize_bytes(ptr0, len0, options);
    const svgResult = this.getStringFromWasm(ret[0], ret[1]);
    this.wasm.__wbindgen_free(ret[0], ret[1], 1);
    return svgResult;
  }
}
