import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
// Tiny stack ISA v1: $MAKEFUN_INPUT_DIR/<id>/{program,input}.bin in,
// $MAKEFUN_OUTPUT_DIR/<id>/{stdout.bin,exit.txt} out. ISA.md is the spec.
const IN_DIR=process.env.MAKEFUN_INPUT_DIR??'/input';
const OUT_DIR=process.env.MAKEFUN_OUTPUT_DIR??'/output';
const STACK_MAX=256,CALL_MAX=64,MEM_WORDS=256,STEP_MAX=1e6,OUT_MAX=65536;
const T_UNDER=2,T_OVER=3,T_DIV=4,T_OP=5,T_ADDR=6,T_CALL=7,T_RET=8,T_PC=9,T_STEP=10,T_OUT=11;
// Per opcode 0x00..0x53, one char: (imm<<4|pops<<2|pushes)+32; '~' marks an invalid opcode.
const S=' 1a$&*+/~~~~~~~~)))))))%)))%)))~)))~~~~~~~~~~~~~@DD@ ~~~~~~~~~~~%(~~~~~~~~~~~~~~$$!$';

function run(program,input){
const stack=new Int32Array(STACK_MAX),calls=new Int32Array(CALL_MAX);
const mem=new Int32Array(MEM_WORDS),out=new Uint8Array(OUT_MAX);
let sp=0,cp=0,pc=0,ip=0,len=0;
const done=code=>({bytes:out.subarray(0,len),code});
for(let step=0;step<STEP_MAX;step++){
if(pc<0||pc>=program.length)return done(T_PC);
const op=program[pc];
if(op>=0x54)return done(T_OP);
const s=S.charCodeAt(op)-32,imm=s>>4,pops=s>>2&3,pushes=s&3;
if(imm>4)return done(T_OP);
const next=pc+1+imm;
if(next>program.length)return done(T_PC);
if(sp<pops)return done(T_UNDER);
if(sp-pops+pushes>STACK_MAX)return done(T_OVER);
pc=next;const d=((program[next-2]|program[next-1]<<8)<<16)>>16;
switch(op){
case 0x00:return done(0);
case 0x01:stack[sp++]=(program[next-1]<<24)>>24;break;
case 0x02:stack[sp++]=program[next-4]|program[next-3]<<8|program[next-2]<<16|program[next-1]<<24;break;
case 0x03:sp--;break;
case 0x04:stack[sp]=stack[sp-1];sp++;break;
case 0x05:{const t=stack[sp-1];stack[sp-1]=stack[sp-2];stack[sp-2]=t;break}
case 0x06:stack[sp]=stack[sp-2];sp++;break;
case 0x07:{const t=stack[sp-3];stack[sp-3]=stack[sp-2];stack[sp-2]=stack[sp-1];stack[sp-1]=t;break}
case 0x17:stack[sp-1]=-stack[sp-1]|0;break;
case 0x1b:stack[sp-1]=~stack[sp-1];break;
case 0x10:case 0x11:case 0x12:case 0x13:case 0x14:case 0x15:case 0x16:
case 0x18:case 0x19:case 0x1a:case 0x1c:case 0x1d:case 0x1e:
case 0x20:case 0x21:case 0x22:{
const a=stack[sp-2],b=stack[sp-1];let r;
if(op===0x10)r=a+b|0;
else if(op===0x11)r=a-b|0;
else if(op===0x12)r=Math.imul(a,b);
else if(op===0x13){if(b===0)return done(T_DIV);r=a===-2147483648&&b===-1?a:a/b|0}
else if(op===0x14){if(b===0)return done(T_DIV);r=b===-1?0:a%b|0}
else if(op===0x15){if(b===0)return done(T_DIV);r=Math.floor((a>>>0)/(b>>>0))|0}
else if(op===0x16){if(b===0)return done(T_DIV);r=(a>>>0)%(b>>>0)|0}
else if(op===0x18)r=a&b;
else if(op===0x19)r=a|b;
else if(op===0x1a)r=a^b;
else if(op===0x1c)r=a<<(b&31);
else if(op===0x1d)r=a>>(b&31);
else if(op===0x1e)r=a>>>(b&31)|0;
else if(op===0x20)r=a===b?1:0;
else if(op===0x21)r=a<b?1:0;
else r=(a>>>0)<(b>>>0)?1:0;
stack[sp-2]=r;sp--;break;
}
case 0x30:pc=next+d;break;
case 0x31:case 0x32:{
const v=stack[--sp];
if(op===0x31?v===0:v!==0)pc=next+d;
break;
}
case 0x33:if(cp===CALL_MAX)return done(T_CALL);calls[cp++]=next;pc=program[next-2]|program[next-1]<<8;break;
case 0x34:if(cp===0)return done(T_RET);pc=calls[--cp];break;
case 0x40:{const a=stack[sp-1];if(a<0||a>255)return done(T_ADDR);stack[sp-1]=mem[a];break}
case 0x41:{const a=stack[sp-1],v=stack[sp-2];if(a<0||a>255)return done(T_ADDR);sp-=2;mem[a]=v;break}
case 0x50:{
const text=String(stack[sp-1]);
if(len+text.length>OUT_MAX)return done(T_OUT);
for(let k=0;k<text.length;k++)out[len++]=text.charCodeAt(k);
sp--;break;
}
case 0x51:{const v=stack[--sp];if(len===OUT_MAX)return done(T_OUT);out[len++]=v&255;break}
case 0x52:stack[sp++]=ip<input.length?input[ip++]:-1;break;
case 0x53:return done(stack[--sp]&255);
default:return done(T_OP);
}
}
return done(T_STEP);
}

for(const id of readdirSync(IN_DIR).sort()){
const r=run(new Uint8Array(readFileSync(join(IN_DIR,id,'program.bin'))),new Uint8Array(readFileSync(join(IN_DIR,id,'input.bin'))));
mkdirSync(join(OUT_DIR,id),{recursive:true});
writeFileSync(join(OUT_DIR,id,'stdout.bin'),r.bytes);
writeFileSync(join(OUT_DIR,id,'exit.txt'),r.code+'\n');
}
