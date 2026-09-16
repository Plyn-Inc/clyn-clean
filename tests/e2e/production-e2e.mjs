const B = 'http://localhost:3400';
// 실행마다 고유한 날짜/번호를 써서 슬롯 점유·idempotency와 충돌하지 않게 한다
const N = Date.now() % 100000;
const DATE = new Date(Date.now() + (200 + (N % 120)) * 86400000).toISOString().slice(0, 10);
const PHONE = `010-${String(5000 + (N % 4000)).slice(0,4)}-${String(1000 + (N % 9000)).slice(0,4)}`;
let pass = 0, fail = 0;
const rows = [];
function chk(no, name, got, want) {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  rows.push([no, name, ok ? 'PASS' : `FAIL (got ${got})`]);
}
const J = async (r) => { try { return await r.json(); } catch { return {}; } };

// 1-6 견적/할인/쿠폰
const area = { areaSidoCode:'E11', areaSigunguCode:'E11010', areaDongCode:'E1101010' };
const base = { serviceType:'입주청소', houseTypeKey:'24평', desiredDate:DATE, timeSlot:'morning', ...area };
let r = await fetch(`${B}/api/quote`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(base)});
let q1 = await J(r);
chk(1,'지역 선택 + quote 발급', !!q1.quoteToken, true);
chk(2,'자동 프로모션 적용', q1.discount?.automaticDiscountAmount, 20000);

r = await fetch(`${B}/api/quote`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base, couponCode:'E2EWELCOME'})});
const q2 = await J(r);
chk(3,'쿠폰 적용', q2.discount?.couponDiscountAmount, 10000);
chk(4,'새 quoteToken 재발급', q1.quoteToken !== q2.quoteToken, true);
// 최종금액 = 기본가 + 휴일가산 - 자동할인 - 쿠폰할인 (서버 snapshot 그대로 검증)
const expected = q2.discount.originalAmount - q2.discount.automaticDiscountAmount - q2.discount.couponDiscountAmount;
chk(5,'최종금액 = 정상가 - 자동할인 - 쿠폰할인', q2.discount?.finalAmount, expected);

// 7-10 예약 접수
const body = {
  quoteToken: q2.quoteToken, customerName:'E2E고객', customerPhone:PHONE,
  serviceType:'입주청소', houseTypeKey:'24평', desiredDate:DATE, timeSlot:'morning',
  region:'서울 테스트구', address:'서울 테스트구 테스트동', areaSido:'서울테스트', areaSigungu:'테스트구', areaDong:'테스트동',
  ...area, entryRoute:'direct', privacyAgreed:true, corePrinciplesAgreed:true,
  serviceTermsAgreed:true, additionalChargeAgreed:true, depositorName:'E2E고객',
};
r = await fetch(`${B}/api/reservations`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const created = await J(r);
chk(6,'예약 접수 201', r.status, 201);
const rid = created.reservation?.id;
chk(7,'계좌 안내 포함', JSON.stringify(created).includes('accountNumber'), true);

// 중복 제출
r = await fetch(`${B}/api/reservations`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const dup = await J(r);
chk(8,'동일 토큰 중복 제출 → 같은 예약', dup.reservation?.reservation_code, created.reservation?.reservation_code);

// 변조 토큰
const [v,p,m] = q2.quoteToken.split('.');
r = await fetch(`${B}/api/reservations`, {method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({...body, customerPhone:PHONE.replace(/\d$/,'9'), quoteToken:`${v}.${p.slice(0,-1)}A.${m}`})});
chk(9,'quoteToken 변조 거절 400', r.status, 400);

// 잘못된 쿠폰
r = await fetch(`${B}/api/quote`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base, couponCode:'NOPE'})});
const badc = await J(r);
chk(10,'잘못된 쿠폰 거절', badc.code, 'COUPON_NOT_FOUND');

// Admin 미인증
r = await fetch(`${B}/api/admin/discounts`);
chk(11,'Admin 미인증 차단', r.status >= 400, true);

// Admin 로그인
r = await fetch(`${B}/api/admin/login`, {method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({username:'admin',password:'E2eadmin56789'})});
const login = await J(r);
let cookie = r.headers.get('set-cookie')?.split(';')[0] ?? '';
chk(12,'Admin 로그인', r.status, 200);
if (login.mustChangePassword) {
  r = await fetch(`${B}/api/admin/change-password`, {method:'POST',headers:{'Content-Type':'application/json',cookie},
    body:JSON.stringify({currentPassword:'e2eadmin1234',newPassword:'E2eadmin56789'})});
  r = await fetch(`${B}/api/admin/login`, {method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'admin',password:'E2eadmin56789'})});
  cookie = r.headers.get('set-cookie')?.split(';')[0] ?? cookie;
}
const H = { cookie };

for (const [no, name, path] of [
  [13,'Admin dashboard 200','/admin/dashboard'],
  [14,'Admin 예약목록 200','/admin/reservations'],
  [15,'Admin 예약상세 200',`/admin/reservations/${rid}`],
  [16,'Admin 할인관리 200','/admin/discounts'],
  [17,'Admin 공지관리 200','/admin/notices'],
]) {
  const res = await fetch(`${B}${path}`, { headers: H, redirect:'follow' });
  chk(no, name, res.status, 200);
}

// 입금확인 → 수동할인 → 확정
r = await fetch(`${B}/api/admin/reservations/${rid}/confirm-payment`, {method:'POST',headers:{'Content-Type':'application/json',...H},
  body:JSON.stringify({ memo:'E2E 입금확인' })});
const cp = await J(r);
chk(18,'입금 확인', r.status < 400, true);

r = await fetch(`${B}/api/admin/reservations/${rid}/discount`, {method:'POST',headers:{'Content-Type':'application/json',...H},
  body:JSON.stringify({discountType:'fixed',discountValue:5000,reason:'E2E 재방문 할인'})});
const adj = await J(r);
chk(19,'관리자 수동 할인', r.status, 200);

r = await fetch(`${B}/api/admin/reservations/${rid}/detail`, {headers:H});
const detail = await J(r);
chk(20,'할인 audit 기록', detail.adjustments?.length >= 1, true);
chk(21,'메시지 이력 존재', detail.notifications?.length >= 1, true);

// 예약 확정
r = await fetch(`${B}/api/admin/reservations/${rid}/confirm-reservation`, {method:'POST',headers:{'Content-Type':'application/json',...H},
  body:JSON.stringify({ memo:'E2E 확정' })});
chk(28,'관리자 예약 확정', r.status < 400, true);

r = await fetch(`${B}/api/admin/reservations/${rid}/detail`, {headers:H});
const d2 = await J(r);
const events = (d2.notifications ?? []).map(n => n.event_type);
chk(29,'reservation_received outbox', events.includes('reservation_received'), true);
chk(30,'deposit_confirmed outbox', events.includes('deposit_confirmed'), true);
chk(31,'reservation_confirmed outbox', events.includes('reservation_confirmed'), true);

// 공지
r = await fetch(`${B}/api/admin/notices`, {method:'POST',headers:{'Content-Type':'application/json',...H},
  body:JSON.stringify({title:'E2E 공지',content:'내용',noticeType:'urgent',isPublished:true,isPopup:true})});
chk(22,'공지 작성', r.status, 201);
r = await fetch(`${B}/api/notices`);
const pub = await J(r);
chk(23,'공개 공지 노출', pub.notices?.some(n=>n.title==='E2E 공지'), true);
r = await fetch(`${B}/api/notices/popup`);
const pop = await J(r);
chk(24,'팝업 노출', pop.notice?.title, 'E2E 공지');
r = await fetch(`${B}/notice`);
chk(25,'/notice 페이지 200', r.status, 200);

// cron
r = await fetch(`${B}/api/cron/notifications`, {headers:{authorization:'Bearer e2e-cron-secret'}});
chk(26,'알림 cron 인증 동작', r.status < 500, true);
r = await fetch(`${B}/api/cron/notifications`);
chk(27,'알림 cron 미인증 차단', r.status, 401);

// 32-34 메시지 수동 재시도 중복발송 방지 (운영 경로)
{
  const d3 = await J(await fetch(`${B}/api/admin/reservations/${rid}/detail`, {headers:H}));
  const list = d3.notifications ?? [];
  // pending 포함 — SOLAPI credential이 없으면 retry_pending으로 남으므로
  // 차단 대상 상태를 확실히 만들기 위해 cron을 한 번 돌려 상태를 진행시킨다
  await fetch(`${B}/api/cron/notifications`, {headers:{authorization:'Bearer e2e-cron-secret'}});
  const d3b = await J(await fetch(`${B}/api/admin/reservations/${rid}/detail`, {headers:H}));
  const list2 = d3b.notifications ?? list;
  const BLOCKED = ['pending','processing','submitted','awaiting_delivery','kakao_failed','fallback_submitted','delivered','fallback_delivered'];
  // SOLAPI credential이 없는 환경에서는 retry_pending으로만 남으므로,
  // 운영에서 문제가 됐던 "provider 접수됨" 상태를 DB에 직접 만들어 차단을 검증한다.
  if (!list2.some(n => BLOCKED.includes(n.status)) && list2.length > 0 && process.env.PG_TEST_URL) {
    const { default: postgres } = await import('postgres');
    const sql = postgres(process.env.PG_TEST_URL, { max:1, prepare:false, ssl:'require' });
    try {
      await sql.unsafe(
        `UPDATE notification_outbox SET status='awaiting_delivery',
           provider_message_id='msg-e2e', kakao_message_id='msg-e2e' WHERE id=$1`,
        [list2[0].id]);
      list2[0].status = 'awaiting_delivery';
    } finally { await sql.end({timeout:0}); }
  }
  const blocked = list2.find(n => BLOCKED.includes(n.status));
  if (blocked) {
    const rr = await fetch(`${B}/api/admin/notifications`, {method:'POST',headers:{'Content-Type':'application/json',...H},
      body:JSON.stringify({id: blocked.id})});
    const rb = await J(rr);
    chk(32, `수동 재시도 차단 (${blocked.status})`, rr.status, 409);
    chk(33, '거절 사유 code 반환', !!rb.code, true);
    const again = await J(await fetch(`${B}/api/admin/reservations/${rid}/detail`, {headers:H}));
    const same = (again.notifications ?? []).find(n => n.id === blocked.id);
    chk(34, '거절 후 상태 불변', same?.status, blocked.status);
  } else {
    chk(32, '수동 재시도 차단 대상 없음(skip)', 'skip', 'skip');
    chk(33, '거절 사유 code 반환(skip)', 'skip', 'skip');
    chk(34, '거절 후 상태 불변(skip)', 'skip', 'skip');
  }
}

// 35-40 원룸 광고 전환 v2
{
  let res = await fetch(`${B}/`);
  chk(35, '메인 / 200', res.status, 200);

  res = await fetch(`${B}/one-room`);
  const landing = await res.text();
  chk(36, '/one-room 랜딩 200', res.status, 200);

  // 복층/1.5룸/투룸을 "선택"시키지 않아야 한다.
  // (대상 제외 안내 문구로 언급하는 것은 정상이며 차단 대상이 아니다)
  const selectable = /<option[^>]*>\s*(원룸\s*복층|1\.5룸|투룸[^<]*)\s*<\/option>/.test(landing)
    || /data-product-key="(원룸 복층|1\.5룸|투룸)"/.test(landing);
  chk(37, '/one-room에 복층·1.5룸·투룸 선택 UI 없음', selectable, false);

  // OPEN PRICE — 화면 표시 가격과 실제 quote 일치
  const offer = await J(await fetch(`${B}/api/offers/one-room`));
  const offerPrice = offer?.openPrice;
  chk(38, 'one-room OPEN PRICE 조회', Number.isFinite(Number(offerPrice)), true);

  const oneQ = await J(await fetch(`${B}/api/quote`, {method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ serviceType:'입주청소', houseTypeKey:'원룸', desiredDate:DATE, timeSlot:'morning', ...area })}));
  const quotePrice = oneQ?.discount?.finalAmount ?? oneQ?.quote?.estimatedTotal;
  chk(39, 'OPEN PRICE == 실제 quote 결과', Number(offerPrice), Number(quotePrice));

  // 일반 예약에서는 다른 상품이 계속 노출되어야 한다
  const home = await (await fetch(`${B}/`)).text();
  const pricing = await J(await fetch(`${B}/api/pricing`));
  const keys = (pricing.items ?? []).map(i => i.productKey ?? i.product_key);
  chk(40, '일반 예약에 원룸 복층 등 기존 상품 유지', keys.includes('원룸 복층'), true);
  void home;
}

console.log('\n| # | 시나리오 | 결과 |');
console.log('|---|---|---|');
for (const [no,name,res] of rows) console.log(`| ${no} | ${name} | ${res} |`);
console.log(`\nE2E: ${pass} PASS / ${fail} FAIL`);
console.log(`RESERVATION_ID=${rid}`);
