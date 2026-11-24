import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
// Tiny stack ISA v1: $MAKEFUN_INPUT_DIR/<id>/{program,input}.bin -> $MAKEFUN_OUTPUT_DIR/<id>/{stdout.bin,exit.txt}.
const I=process.env.MAKEFUN_INPUT_DIR??'/input',O=process.env.MAKEFUN_OUTPUT_DIR??'/output';
// opcode:immediate-bytes,pops,pushes (hex). Any byte not listed traps 5.
const D='00:000,01:101,02:401,03:010,04:012,05:022,06:023,07:033,10:021,11:021,12:021,13:021,14:021,15:021,16:021,17:011,18:021,19:021,1a:021,1b:011,1c:021,1d:021,1e:021,20:021,21:021,22:021,30:200,31:210,32:210,33:200,34:000,40:011,41:020,50:010,51:010,52:001,53:010';
const IM=new Int8Array(256).fill(-1),PO=new Int8Array(256),PU=new Int8Array(256);
for(const e of D.split(',')){const k=parseInt(e,16),v=e.slice(3);IM[k]=+v[0];PO[k]=+v[1];PU[k]=+v[2]}
function run(p,inp){
const n=p.length,s=new Int32Array(256),c=new Int32Array(64),m=new Int32Array(256),o=new Uint8Array(65536);
let sp=0,cp=0,pc=0,ip=0,lo=0;
const E=v=>({out:o.subarray(0,lo),code:v});
for(let st=0;st<1e6;st++){
if(pc<0||pc>=n)return E(9);
const b=p[pc],im=IM[b];
if(im<0)return E(5);
const nx=pc+1+im;
if(nx>n)return E(9);
if(sp<PO[b])return E(2);
if(sp-PO[b]+PU[b]>256)return E(3);
pc=nx;
if(b>=16&&b<=34&&b!=23&&b!=27){
const a=s[sp-2],d=s[sp-1];let r;
switch(b){
case 16:r=a+d|0;break;
case 17:r=a-d|0;break;
case 18:r=Math.imul(a,d);break;
case 19:if(!d)return E(4);r=a==-2147483648&&d==-1?a:a/d|0;break;
case 20:if(!d)return E(4);r=d==-1?0:a%d|0;break;
case 21:case 22:{const u=a>>>0,v=d>>>0;if(!v)return E(4);r=b==21?Math.floor(u/v)|0:u%v|0;break}
case 24:r=a&d;break;
case 25:r=a|d;break;
case 26:r=a^d;break;
case 28:r=a<<(d&31);break;
case 29:r=a>>(d&31);break;
case 30:r=a>>>(d&31)|0;break;
case 32:r=a==d?1:0;break;
case 33:r=a<d?1:0;break;
default:r=(a>>>0)<(d>>>0)?1:0;
}
s[sp-2]=r;sp--;continue;
}
switch(b){
case 0:return E(0);
case 1:s[sp++]=p[nx-1]<<24>>24;break;
case 2:s[sp++]=p[nx-4]|p[nx-3]<<8|p[nx-2]<<16|p[nx-1]<<24;break;
case 3:sp--;break;
case 4:s[sp]=s[sp-1];sp++;break;
case 5:{const t=s[sp-1];s[sp-1]=s[sp-2];s[sp-2]=t;break}
case 6:s[sp]=s[sp-2];sp++;break;
case 7:{const t=s[sp-3];s[sp-3]=s[sp-2];s[sp-2]=s[sp-1];s[sp-1]=t;break}
case 23:s[sp-1]=-s[sp-1]|0;break;
case 27:s[sp-1]=~s[sp-1];break;
case 48:case 49:case 50:{
const r=((p[nx-2]|p[nx-1]<<8)<<16)>>16;
let j=b==48;
if(b!=48){const v=s[--sp];j=b==49?v==0:v!=0}
if(j)pc=nx+r;
break;
}
case 51:if(cp==64)return E(7);c[cp++]=nx;pc=p[nx-2]|p[nx-1]<<8;break;
case 52:if(!cp)return E(8);pc=c[--cp];break;
case 64:{const a=s[sp-1];if(a<0||a>255)return E(6);s[sp-1]=m[a];break}
case 65:{const a=s[sp-1],v=s[sp-2];if(a<0||a>255)return E(6);sp-=2;m[a]=v;break}
case 80:{
const t=''+s[sp-1];
if(lo+t.length>65536)return E(11);
for(let k=0;k<t.length;k++)o[lo++]=t.charCodeAt(k);
sp--;break;
}
case 81:if(lo==65536)return E(11);o[lo++]=s[--sp]&255;break;
case 82:s[sp++]=ip<inp.length?inp[ip++]:-1;break;
case 83:return E(s[--sp]&255);
default:return E(5);
}
}
return E(10);
}
for(const id of readdirSync(I).sort()){
const r=run(new Uint8Array(readFileSync(join(I,id,'program.bin'))),new Uint8Array(readFileSync(join(I,id,'input.bin'))));
mkdirSync(join(O,id),{recursive:true});
writeFileSync(join(O,id,'stdout.bin'),r.out);
writeFileSync(join(O,id,'exit.txt'),r.code+'\n');
}
