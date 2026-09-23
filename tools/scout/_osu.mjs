import {ST} from './_states.mjs';
import fs from 'node:fs';
const t=fs.readFileSync(process.env.TEMP+'/osu.txt','utf8');
const s=t.slice(t.indexOf('148 result(s)')).split('\n').map(x=>x.trim()).filter(Boolean).slice(2);
const seen=new Set(), out=[];
for(let i=0;i<s.length;i++){
  if(s[i]!=='Location') continue;
  let j=i-1; if(/^Phone/.test(s[j])) j--; const name=s[j];
  const street=s[i+1], cityz=s[i+2], club=s[i+3];
  const m=cityz&&cityz.match(/^(.+?), ([A-Za-z ]+?) (\d{5})/); if(!m||!/Club|OH|\//.test(club||'')) {console.error('skip',name,street,cityz);continue;}
  const key=(name+street).toLowerCase(); if(seen.has(key)) continue; seen.add(key);
  const st=ST[m[2]]||m[2];
  out.push({venue:name,address:`${street}, ${m[1]}, ${st} ${m[3]}`,club:club.replace(/^[A-Z]{2} ?\/ ?/,''),cityState:m[1]+', '+m[2]});
}
fs.writeFileSync(process.env.TEMP+'/osu.json',JSON.stringify(out,null,1));
console.log(out.length);console.log(out.slice(0,5));
