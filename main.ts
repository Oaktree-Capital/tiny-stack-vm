// A tiny stack virtual machine: an interpreter of make.fun's tiny stack ISA v1.
// For every instance under $MAKEFUN_INPUT_DIR (default /input) it runs program.bin
// on input.bin and writes, under $MAKEFUN_OUTPUT_DIR (default /output), the bytes
// the program wrote (stdout.bin) and the exit code it ended on (exit.txt).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const STACK_MAX = 256; // values the data stack holds
const CALLS_MAX = 64; // return addresses the call stack holds
const MEM_WORDS = 256; // memory words, all zero at the start
const STEP_LIMIT = 1_000_000; // instructions one program may execute
const OUTPUT_MAX = 65_536; // bytes one program may write

// Per opcode: the bytes of its immediate, and how many values it pops and pushes.
// An immediate of -1 marks a byte that is no opcode at all (trap 5).
const IMM = new Int8Array(256).fill(-1);
const POPS = new Int8Array(256);
const PUSHES = new Int8Array(256);
const op = (byte: number, imm: number, pops: number, pushes: number): void => {
  IMM[byte] = imm;
  POPS[byte] = pops;
  PUSHES[byte] = pushes;
};
op(0x00, 0, 0, 0); // HALT
op(0x01, 1, 0, 1); // PUSH8
op(0x02, 4, 0, 1); // PUSH32
op(0x03, 0, 1, 0); // POP
op(0x04, 0, 1, 2); // DUP
op(0x05, 0, 2, 2); // SWAP
op(0x06, 0, 2, 3); // OVER
op(0x07, 0, 3, 3); // ROT
for (let b = 0x10; b <= 0x16; b++) op(b, 0, 2, 1); // ADD SUB MUL DIV MOD DIVU MODU
op(0x17, 0, 1, 1); // NEG
for (let b = 0x18; b <= 0x1a; b++) op(b, 0, 2, 1); // AND OR XOR
op(0x1b, 0, 1, 1); // NOT
for (let b = 0x1c; b <= 0x1e; b++) op(b, 0, 2, 1); // SHL SHR SHRU
for (let b = 0x20; b <= 0x22; b++) op(b, 0, 2, 1); // EQ LT LTU
op(0x30, 2, 0, 0); // JMP
op(0x31, 2, 1, 0); // JZ
op(0x32, 2, 1, 0); // JNZ
op(0x33, 2, 0, 0); // CALL
op(0x34, 0, 0, 0); // RET
op(0x40, 0, 1, 1); // LOAD
op(0x41, 0, 2, 0); // STORE
op(0x50, 0, 1, 0); // PRINT
op(0x51, 0, 1, 0); // PUTC
op(0x52, 0, 0, 1); // IN
op(0x53, 0, 1, 0); // EXIT

type Answer = { out: Uint8Array; code: number };

// Runs one program to its end: the bytes it wrote and its exit code (a trap's
// code included). The instruction that traps counts as a step and writes nothing.
function run(prog: Uint8Array, input: Uint8Array): Answer {
  const size = prog.length;
  const stack = new Int32Array(STACK_MAX);
  const calls = new Int32Array(CALLS_MAX);
  const memory = new Int32Array(MEM_WORDS);
  const out = new Uint8Array(OUTPUT_MAX);
  let sp = 0; // values on the data stack
  let cp = 0; // return addresses on the call stack
  let ip = 0; // bytes of input read
  let pc = 0; // program counter
  let steps = 0; // instructions executed
  let olen = 0; // bytes written

  const trap = (code: number): Answer => ({ out: out.subarray(0, olen), code });

  for (;;) {
    if (steps === STEP_LIMIT) return trap(10);
    if (pc < 0 || pc >= size) return trap(9);
    const b = prog[pc];
    const imm = IMM[b];
    if (imm < 0) return trap(5);
    if (pc + imm >= size) return trap(9);
    steps++;
    const next = pc + 1 + imm;
    if (sp < POPS[b]) return trap(2);
    if (sp - POPS[b] + PUSHES[b] > STACK_MAX) return trap(3);
    pc = next;

    switch (b) {
      case 0x00: // HALT
        return trap(0);

      case 0x01: // PUSH8: a signed byte, sign-extended
        stack[sp++] = (prog[next - 1] << 24) >> 24;
        break;

      case 0x02: // PUSH32: little-endian, signed
        stack[sp++] =
          prog[next - 4] | (prog[next - 3] << 8) | (prog[next - 2] << 16) | (prog[next - 1] << 24);
        break;

      case 0x03: // POP
        sp--;
        break;

      case 0x04: // DUP
        stack[sp] = stack[sp - 1];
        sp++;
        break;

      case 0x05: {
        // SWAP
        const t = stack[sp - 1];
        stack[sp - 1] = stack[sp - 2];
        stack[sp - 2] = t;
        break;
      }

      case 0x06: // OVER
        stack[sp] = stack[sp - 2];
        sp++;
        break;

      case 0x07: {
        // ROT: ( a b c -- b c a )
        const a = stack[sp - 3];
        stack[sp - 3] = stack[sp - 2];
        stack[sp - 2] = stack[sp - 1];
        stack[sp - 1] = a;
        break;
      }

      case 0x10: // ADD
        stack[sp - 2] = (stack[sp - 2] + stack[sp - 1]) | 0;
        sp--;
        break;

      case 0x11: // SUB
        stack[sp - 2] = (stack[sp - 2] - stack[sp - 1]) | 0;
        sp--;
        break;

      case 0x12: // MUL: the low 32 bits of the exact product
        stack[sp - 2] = Math.imul(stack[sp - 2], stack[sp - 1]);
        sp--;
        break;

      case 0x13: {
        // DIV: signed, truncated toward zero; -2147483648 / -1 stays itself
        const a = stack[sp - 2];
        const d = stack[sp - 1];
        if (d === 0) return trap(4);
        stack[sp - 2] = a === -2147483648 && d === -1 ? a : (a / d) | 0;
        sp--;
        break;
      }

      case 0x14: {
        // MOD: signed remainder taking the sign of a; x % -1 is 0
        const a = stack[sp - 2];
        const d = stack[sp - 1];
        if (d === 0) return trap(4);
        stack[sp - 2] = d === -1 ? 0 : (a % d) | 0;
        sp--;
        break;
      }

      case 0x15: {
        // DIVU: both read unsigned, the quotient read back signed
        const a = stack[sp - 2] >>> 0;
        const d = stack[sp - 1] >>> 0;
        if (d === 0) return trap(4);
        stack[sp - 2] = Math.floor(a / d) | 0;
        sp--;
        break;
      }

      case 0x16: {
        // MODU: the unsigned remainder, read back signed
        const a = stack[sp - 2] >>> 0;
        const d = stack[sp - 1] >>> 0;
        if (d === 0) return trap(4);
        stack[sp - 2] = (a % d) | 0;
        sp--;
        break;
      }

      case 0x17: // NEG
        stack[sp - 1] = -stack[sp - 1] | 0;
        break;

      case 0x18: // AND
        stack[sp - 2] = stack[sp - 2] & stack[sp - 1];
        sp--;
        break;

      case 0x19: // OR
        stack[sp - 2] = stack[sp - 2] | stack[sp - 1];
        sp--;
        break;

      case 0x1a: // XOR
        stack[sp - 2] = stack[sp - 2] ^ stack[sp - 1];
        sp--;
        break;

      case 0x1b: // NOT
        stack[sp - 1] = ~stack[sp - 1];
        break;

      case 0x1c: // SHL: only the low five bits of the count count
        stack[sp - 2] = stack[sp - 2] << (stack[sp - 1] & 31);
        sp--;
        break;

      case 0x1d: // SHR: arithmetic
        stack[sp - 2] = stack[sp - 2] >> (stack[sp - 1] & 31);
        sp--;
        break;

      case 0x1e: // SHRU: logical, read back signed
        stack[sp - 2] = (stack[sp - 2] >>> (stack[sp - 1] & 31)) | 0;
        sp--;
        break;

      case 0x20: // EQ
        stack[sp - 2] = stack[sp - 2] === stack[sp - 1] ? 1 : 0;
        sp--;
        break;

      case 0x21: // LT: signed
        stack[sp - 2] = stack[sp - 2] < stack[sp - 1] ? 1 : 0;
        sp--;
        break;

      case 0x22: // LTU: unsigned
        stack[sp - 2] = (stack[sp - 2] >>> 0) < (stack[sp - 1] >>> 0) ? 1 : 0;
        sp--;
        break;

      case 0x30: // JMP
      case 0x31: // JZ
      case 0x32: {
        // JNZ: a signed 16-bit offset from the instruction after the immediate
        const rel = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
        let jump = b === 0x30;
        if (b !== 0x30) {
          const v = stack[--sp];
          jump = b === 0x31 ? v === 0 : v !== 0;
        }
        if (jump) pc = next + rel;
        break;
      }

      case 0x33: // CALL: an absolute address, 0 to 65535
        if (cp === CALLS_MAX) return trap(7);
        calls[cp++] = next;
        pc = prog[next - 2] | (prog[next - 1] << 8);
        break;

      case 0x34: // RET
        if (cp === 0) return trap(8);
        pc = calls[--cp];
        break;

      case 0x40: {
        // LOAD
        const addr = stack[sp - 1];
        if (addr < 0 || addr >= MEM_WORDS) return trap(6);
        stack[sp - 1] = memory[addr];
        break;
      }

      case 0x41: {
        // STORE
        const addr = stack[sp - 1];
        const v = stack[sp - 2];
        if (addr < 0 || addr >= MEM_WORDS) return trap(6);
        sp -= 2;
        memory[addr] = v;
        break;
      }

      case 0x50: {
        // PRINT: decimal ASCII, a leading - when negative, nothing else
        const text = String(stack[sp - 1]);
        if (olen + text.length > OUTPUT_MAX) return trap(11);
        for (let i = 0; i < text.length; i++) out[olen++] = text.charCodeAt(i);
        sp--;
        break;
      }

      case 0x51: // PUTC: the value's low byte
        if (olen === OUTPUT_MAX) return trap(11);
        out[olen++] = stack[--sp] & 255;
        break;

      case 0x52: // IN: the next byte, and -1 once the input is used up
        stack[sp++] = ip < input.length ? input[ip++] : -1;
        break;

      case 0x53: // EXIT: the value's low byte
        return { out: out.subarray(0, olen), code: stack[--sp] & 255 };

      default: // unreachable: IMM[b] < 0 already trapped
        return trap(5);
    }
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  const answer = run(
    new Uint8Array(readFileSync(join(IN_DIR, id, 'program.bin'))),
    new Uint8Array(readFileSync(join(IN_DIR, id, 'input.bin'))),
  );
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'stdout.bin'), answer.out);
  writeFileSync(join(OUT_DIR, id, 'exit.txt'), answer.code + '\n');
}
