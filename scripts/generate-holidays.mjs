import { createRequire } from 'node:module';
const KLC = createRequire(import.meta.url)('korean-lunar-calendar');
const pad=n=>String(n).padStart(2,'0');
const key=(y,m,d)=>`${y}-${pad(m)}-${pad(d)}`;
const dow=s=>{const[y,m,d]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1,d)).getUTCDay();};
function addDays(s,n){const[y,m,d]=s.split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d+n));
  return key(t.getUTCFullYear(),t.getUTCMonth()+1,t.getUTCDate());}
// 음력 → 양력
function lunarToSolar(y,m,d){const c=new KLC();if(!c.setLunarDate(y,m,d,false))return null;
  const s=c.getSolarCalendar();return key(s.year,s.month,s.day);}

/**
 * 공직선거법상 임기만료에 의한 선거일 (관공서의 공휴일에 관한 규정 제2조 제10호).
 *
 * 임시공휴일과 재·보궐선거일은 정부 발표 후 수기로 추가한다.
 * 선거일은 대체공휴일 적용 대상이 아니다.
 *
 * 형식: "YYYY-MM-DD": "선거명"
 */
const ELECTION_DAYS = {
  // 제9회 전국동시지방선거 (2026-06-03)
  "2026-06-03": "제9회 전국동시지방선거",
  // 제23대 국회의원선거 (2028-04-12, 4년 주기 4월 둘째 수요일)
  "2028-04-12": "제23대 국회의원선거",
};

/**
 * 임시공휴일 — 국무회의 의결로 지정된다.
 * 확정되면 여기에 추가한다. 대체공휴일 적용 대상이 아니다.
 */
const TEMPORARY_HOLIDAYS = {
  // 예: "2027-10-08": "임시공휴일",
};

function build(year){
  const base=[]; // [date, name, 대체공휴일 적용여부]
  base.push([key(year,1,1),'신정',false]);          // 신정: 대체 미적용
  base.push([key(year,3,1),'삼일절',true]);
  base.push([key(year,5,1),'노동절',true]);          // 2026 개정으로 공휴일+대체 적용
  base.push([key(year,5,5),'어린이날',true]);
  base.push([key(year,6,6),'현충일',false]);         // 대체 미적용
  base.push([key(year,7,17),'제헌절',true]);         // 2026-05-11 시행으로 부활
  base.push([key(year,8,15),'광복절',true]);
  base.push([key(year,10,3),'개천절',true]);
  base.push([key(year,10,9),'한글날',true]);
  base.push([key(year,12,25),'성탄절',true]);
  // 설날 3일 (음 1/1 기준 전날~다음날)
  const seol=lunarToSolar(year,1,1);
  if(seol){base.push([addDays(seol,-1),'설날 연휴','sun']);base.push([seol,'설날','sun']);base.push([addDays(seol,1),'설날 연휴','sun']);}
  // 부처님오신날 음 4/8
  const bud=lunarToSolar(year,4,8);
  if(bud)base.push([bud,'부처님오신날',true]);
  // 추석 3일 (음 8/15 기준)
  const chu=lunarToSolar(year,8,15);
  if(chu){base.push([addDays(chu,-1),'추석 연휴','sun']);base.push([chu,'추석','sun']);base.push([addDays(chu,1),'추석 연휴','sun']);}

  const map=new Map();
  for(const [d,n] of base) if(!map.has(d)) map.set(d,n);
  // 선거일 / 임시공휴일 — 대체공휴일 적용 대상이 아니므로 대체 계산 전에 넣지 않고
  // occupied 판정에만 참여시킨 뒤 마지막에 합친다.

  // 대체공휴일: 토/일 또는 다른 공휴일과 겹치면 다음 비공휴일
  const subs=[];
  const sorted=[...base].sort((a,b)=>a[0].localeCompare(b[0]));
  // 같은 날짜에 서로 다른 공휴일이 겹쳐도 대체공휴일은 1일만 생성한다.
  // (예: 2028-10-03 개천절 + 추석 연휴 → 대체 1일)
  const substitutedDates=new Set();
  const occupied=new Set(map.keys());
  for(const d of Object.keys(ELECTION_DAYS)) if(d.startsWith(`${year}-`)) occupied.add(d);
  for(const d of Object.keys(TEMPORARY_HOLIDAYS)) if(d.startsWith(`${year}-`)) occupied.add(d);
  for(const [d,n,applies] of sorted){
    if(!applies) continue;
    const w=dow(d);
    // 설날/추석 연휴는 일요일 겹침만 대체 적용 (토요일 미적용)
    // 국경일/어린이날/부처님오신날/성탄절/노동절은 토·일 모두 적용
    const overlapped = applies==='sun'
      ? (w===0 || sorted.filter(x=>x[0]===d).length>1)
      : (w===0 || w===6 || sorted.filter(x=>x[0]===d).length>1);
    if(!overlapped) continue;
    // 이 날짜에 대해 이미 대체공휴일을 만들었으면 건너뛴다
    if(substitutedDates.has(d)) continue;
    substitutedDates.add(d);
    let c=addDays(d,1);
    while(dow(c)===0||dow(c)===6||occupied.has(c)||subs.some(s=>s[0]===c)) c=addDays(c,1);
    subs.push([c,`${n.replace(' 연휴','')} 대체공휴일`]);
    occupied.add(c);
  }
  for(const [d,n] of subs) if(!map.has(d)) map.set(d,n);
  // 선거일 / 임시공휴일 추가 (대체공휴일 미적용)
  for(const [d,n] of Object.entries(ELECTION_DAYS))
    if(d.startsWith(`${year}-`) && !map.has(d)) map.set(d,n);
  for(const [d,n] of Object.entries(TEMPORARY_HOLIDAYS))
    if(d.startsWith(`${year}-`) && !map.has(d)) map.set(d,n);
  return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
}
const argYears = process.argv.slice(2).map(Number).filter(Boolean);
const YEARS = argYears.length ? argYears : [2026, 2027, 2028];
for(const y of YEARS){
  console.log(`  // ${y}`);
  for(const [d,n] of build(y)) console.log(`  "${d}": "${n}",   // ${'일월화수목금토'[dow(d)]}`);
}
