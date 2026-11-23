// A tiny stack virtual machine: an interpreter of make.fun's tiny stack ISA v1.
// Runs each instance under $MAKEFUN_INPUT_DIR into $MAKEFUN_OUTPUT_DIR as <id>/stdout.bin and <id>/exit.txt.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const SMAX = 256; // data stack values
const CMAX = 64; // return addresses
const MMAX = 256; // memory words
const STEPS = 1_000_000; // instructions per program
const OMAX = 65_536; // output bytes per program

// Opcode -> [immediate bytes, pops, pushes]. A byte not listed is no opcode (trap 5).
const T: Record<number, number[]> = {
  0x00: [0, 0, 0], 0x01: [1, 0, 1], 0x02: [4, 0, 1], 0x03: [0, 1, 0], 0x04: [0, 1, 2],
  0x05: [0, 2, 2], 0x06: [0, 2, 3], 0x07: [0, 3, 3], 0x10: [0, 2, 1], 0x11: [0, 2, 1],
  0x12: [0, 2, 1], 0x13: [0, 2, 1], 0x14: [0, 2, 1], 0x15: [0, 2, 1], 0x16: [0, 2, 1],
  0x17: [0, 1, 1], 0x18: [0, 2, 1], 0x19: [0, 2, 1], 0x1a: [0, 2, 1], 0x1b: [0, 1, 1],
  0x1c: [0, 2, 1], 0x1d: [0, 2, 1], 0x1e: [0, 2, 1], 0x20: [0, 2, 1], 0x21: [0, 2, 1],
  0x22: [0, 2, 1], 0x30: [2, 0, 0], 0x31: [2, 1, 0], 0x32: [2, 1, 0], 0x33: [2, 0, 0],
  0x34: [0, 0, 0], 0x40: [0, 1, 1], 0x41: [0, 2, 0], 0x50: [0, 1, 0], 0x51: [0, 1, 0],
  0x52: [0, 0, 1], 0x53: [0, 1, 0],
};
const IMM = new Int8Array(256).fill(-1);
const POP = new Int8Array(256);
const PUSH = new Int8Array(256);
for (const k in T) {
  const [im, po, pu] = T[k];
  IMM[+k] = im;
  POP[+k] = po;
  PUSH[+k] = pu;
}

// Runs one program to its end: the bytes it wrote and its exit code (a trap's code
// included). The instruction that traps counts as a step and writes nothing.
function run(p: Uint8Array, inp: Uint8Array) {
  const n = p.length;
  const s = new Int32Array(SMAX);
  const c = new Int32Array(CMAX);
  const m = new Int32Array(MMAX);
  const o = new Uint8Array(OMAX);
  let sp = 0; // data stack depth
  let cp = 0; // call stack depth
  let ip = 0; // input bytes read
  let pc = 0; // program counter
  let steps = 0; // instructions executed
  let lo = 0; // output bytes written
  const end = (code: number) => ({ out: o.subarray(0, lo), code });

  for (;;) {
    if (steps === STEPS) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const b = p[pc], im = IMM[b];
    if (im < 0) return end(5);
    if (pc + im >= n) return end(9);
    steps++;
    const nx = pc + 1 + im;
    if (sp < POP[b]) return end(2);
    if (sp - POP[b] + PUSH[b] > SMAX) return end(3);
    pc = nx;
    switch (b) {
      case 0x00: return end(0);
      case 0x01: s[sp++] = (p[nx - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 0x02: s[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: s[sp] = s[sp - 1]; sp++; break;
      case 0x05: { const t = s[sp - 1]; s[sp - 1] = s[sp - 2]; s[sp - 2] = t; break; }
      case 0x06: s[sp] = s[sp - 2]; sp++; break;
      case 0x07: { const a = s[sp - 3]; s[sp - 3] = s[sp - 2]; s[sp - 2] = s[sp - 1]; s[sp - 1] = a; break; }
      case 0x10: s[sp - 2] = (s[sp - 2] + s[sp - 1]) | 0; sp--; break;
      case 0x11: s[sp - 2] = (s[sp - 2] - s[sp - 1]) | 0; sp--; break;
      case 0x12: s[sp - 2] = Math.imul(s[sp - 2], s[sp - 1]); sp--; break;
      case 0x13: {
        const a = s[sp - 2], d = s[sp - 1];
        if (d === 0) return end(4);
        s[sp - 2] = a === -2147483648 && d === -1 ? a : (a / d) | 0;
        sp--;
        break;
      }
      case 0x14: {
        const a = s[sp - 2], d = s[sp - 1];
        if (d === 0) return end(4);
        s[sp - 2] = d === -1 ? 0 : (a % d) | 0;
        sp--;
        break;
      }
      case 0x15: {
        const a = s[sp - 2] >>> 0, d = s[sp - 1] >>> 0;
        if (d === 0) return end(4);
        s[sp - 2] = Math.floor(a / d) | 0;
        sp--;
        break;
      }
      case 0x16: {
        const a = s[sp - 2] >>> 0, d = s[sp - 1] >>> 0;
        if (d === 0) return end(4);
        s[sp - 2] = (a % d) | 0;
        sp--;
        break;
      }
      case 0x17: s[sp - 1] = -s[sp - 1] | 0; break;
      case 0x18: s[sp - 2] = s[sp - 2] & s[sp - 1]; sp--; break;
      case 0x19: s[sp - 2] = s[sp - 2] | s[sp - 1]; sp--; break;
      case 0x1a: s[sp - 2] = s[sp - 2] ^ s[sp - 1]; sp--; break;
      case 0x1b: s[sp - 1] = ~s[sp - 1]; break;
      case 0x1c: s[sp - 2] = s[sp - 2] << (s[sp - 1] & 31); sp--; break;
      case 0x1d: s[sp - 2] = s[sp - 2] >> (s[sp - 1] & 31); sp--; break;
      case 0x1e: s[sp - 2] = (s[sp - 2] >>> (s[sp - 1] & 31)) | 0; sp--; break;
      case 0x20: s[sp - 2] = s[sp - 2] === s[sp - 1] ? 1 : 0; sp--; break;
      case 0x21: s[sp - 2] = s[sp - 2] < s[sp - 1] ? 1 : 0; sp--; break;
      case 0x22: s[sp - 2] = (s[sp - 2] >>> 0) < (s[sp - 1] >>> 0) ? 1 : 0; sp--; break;
      case 0x30: case 0x31: case 0x32: {
        // a signed 16-bit offset from the instruction after the immediate
        const r = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        let j = b === 0x30;
        if (b !== 0x30) { const v = s[--sp]; j = b === 0x31 ? v === 0 : v !== 0; }
        if (j) pc = nx + r;
        break;
      }
      case 0x33: // CALL: an absolute address
        if (cp === CMAX) return end(7);
        c[cp++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34: // RET
        if (cp === 0) return end(8);
        pc = c[--cp];
        break;
      case 0x40: { const a = s[sp - 1]; if (a < 0 || a >= MMAX) return end(6); s[sp - 1] = m[a]; break; }
      case 0x41: {
        const a = s[sp - 1], v = s[sp - 2];
        if (a < 0 || a >= MMAX) return end(6);
        sp -= 2;
        m[a] = v;
        break;
      }
      case 0x50: {
        const t = String(s[sp - 1]);
        if (lo + t.length > OMAX) return end(11);
        for (let i = 0; i < t.length; i++) o[lo++] = t.charCodeAt(i);
        sp--;
        break;
      }
      case 0x51: // PUTC: the value's low byte
        if (lo === OMAX) return end(11);
        o[lo++] = s[--sp] & 255;
        break;
      case 0x52: // IN: -1 once the input is used up
        s[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53: // EXIT: the value's low byte
        return end(s[--sp] & 255);
      default:
        return end(5);
    }
  }
}

for (const id of readdirSync(I).sort()) {
  const a = run(
    new Uint8Array(readFileSync(join(I, id, 'program.bin'))),
    new Uint8Array(readFileSync(join(I, id, 'input.bin'))),
  );
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), a.out);
  writeFileSync(join(O, id, 'exit.txt'), a.code + '\n');
}
