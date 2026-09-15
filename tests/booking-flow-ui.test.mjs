import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('예약 폼은 서비스/날짜/고객정보/확인·동의 4단계만 사용한다', () => {
  const src = read('src/components/booking/BookingForm.tsx');
  assert.match(src, /type Step = 1 \| 2 \| 3 \| 4;/);
  assert.match(src, /const STEP_LABELS = \["지역·서비스", "날짜", "고객정보", "확인·동의"\]/);
  assert.doesNotMatch(src, /"현장정보"/);
  assert.doesNotMatch(src, /step === 5/);
  assert.doesNotMatch(src, /step === 6/);
});

test('사이청소는 고객 UI에서 오전/오후가 아니라 all_day와 퇴거/입주 시간을 사용한다', () => {
  const src = read('src/components/booking/BookingForm.tsx');
  assert.match(src, /serviceType === "사이청소"[^]*setTimeSlot\("all_day"\)/);
  assert.match(src, /serviceType === "사이청소" \? \([^]*퇴거 완료 예정시간[^]*TIME_OPTIONS[^]*새 입주 예정시간[^]*TIME_OPTIONS/);
  assert.doesNotMatch(src, /type="time"/);
  assert.match(src, /const TIME_OPTIONS = createHalfHourOptions\(\)/);
  assert.match(src, /value=\{moveOutTime\}[^]*TIME_OPTIONS\.map/);
  assert.match(src, /value=\{moveInTime\}[^]*TIME_OPTIONS\.map/);
  assert.match(src, /moveOutTime:\s*serviceType === "사이청소"/);
  assert.match(src, /moveInTime:\s*serviceType === "사이청소"/);
});

test('가격 요청은 abort 가능한 최신 요청만 상태를 갱신하고 로딩 중 오류 문구를 띄우지 않는다', () => {
  const src = read('src/components/booking/BookingForm.tsx');
  assert.match(src, /new AbortController\(\)/);
  assert.match(src, /signal:\s*controller\.signal/);
  assert.match(src, /setQuoteLoading\(true\)/);
  assert.match(src, /controller\.abort\(\)/);
});

test('예약 API는 사이청소 all_day 계약을 명시한다', () => {
  const src = read('src/app/api/reservations/route.ts');
  assert.match(src, /z\.enum\(\["morning", "afternoon", "all_day"\]/);
  assert.match(src, /data\.serviceType === "사이청소"[^]*data\.timeSlot !== "all_day"/);
  assert.match(src, /data\.serviceType !== "사이청소"[^]*data\.timeSlot === "all_day"/);
});

test('예약 도메인은 all_day 공통 lock과 사이청소 양쪽 슬롯 검증을 사용한다', () => {
  const src = read('src/lib/reservations.ts');
  assert.match(src, /timeSlot:\s*"morning" \| "afternoon" \| "all_day"/);
  assert.match(src, /lockReservationSlot\(input\.desiredDate, "all_day"\)/);
  assert.match(src, /validateAllDayAvailability\(input\.desiredDate\)/);
});

test('예약 선금은 서비스별 예약 생성 snapshot을 우선한다', () => {
  const src = read('src/lib/reservations.ts');
  assert.match(src, /depositAmountSnap(?::[^=]+)?\s*=\s*q\.depositAmount/);
  assert.match(src, /reservation\.deposit_amount_snapshot/);
  assert.match(src, /getServiceProductPrice\(\s*reservation\.service_type/);
  assert.doesNotMatch(src, /getDepositAmountForHouseType/);
});

test('사이청소 예약금 결과는 퇴거/입주 시간을 API와 화면에 표시한다', () => {
  const api = read('src/app/api/reservations/[code]/deposit-account/route.ts');
  const panel = read('src/components/booking/DepositAccountPanel.tsx');
  assert.match(api, /moveOutTime:\s*updated\.move_out_time/);
  assert.match(api, /moveInTime:\s*updated\.move_in_time/);
  assert.match(panel, /moveOutTime:\s*string \| null/);
  assert.match(panel, /moveInTime:\s*string \| null/);
  assert.match(panel, /info\.timeSlot === "all_day"/);
});


test('상담 API도 사이청소 all_day 선호시간을 허용한다', () => {
  const src = read('src/app/api/consultations/route.ts');
  assert.match(src, /preferredTimeSlot:\s*z\.enum\(\["morning", "afternoon", "all_day"\]\)/);
});

test('사이청소 예약은 관리자에서도 all_day를 유지하고 재개방 화면으로만 남는 슬롯을 연다', () => {
  const domain = read('src/lib/reservations.ts');
  const page = read('src/app/admin/(protected)/reservations/[id]/page.tsx');
  assert.match(domain, /current\.service_type === "사이청소"[^]*all_day/);
  assert.match(page, /reservation\.time_slot === "all_day"[^]*사이청소 종일 보호/);
  assert.match(page, /reservation\.move_out_time/);
  assert.match(page, /reservation\.move_in_time/);
  assert.match(page, /reservation\.service_type !== "사이청소"[^]*<SlotChangePanel/);
  assert.match(page, /href="\/admin\/slot-reopen"/);
});

test('사이청소 퇴거/입주 시간은 선택 날짜와 같은 날이며 도메인에서도 필수 검증한다', () => {
  const api = read('src/app/api/reservations/route.ts');
  const domain = read('src/lib/reservations.ts');
  assert.match(api, /data\.moveOutTime\.startsWith\(`\$\{data\.desiredDate\}T`\)/);
  assert.match(api, /data\.moveInTime\.startsWith\(`\$\{data\.desiredDate\}T`\)/);
  assert.match(domain, /input\.serviceType === "사이청소"[^]*input\.moveOutTime[^]*input\.moveInTime/);
  assert.match(domain, /input\.moveOutTime\.startsWith\(`\$\{input\.desiredDate\}T`\)/);
});

test('가격 오류 문구는 현재 견적 요청이 실제 실패한 경우에만 표시한다', () => {
  const src = read('src/components/booking/BookingForm.tsx');
  assert.match(src, /const \[quoteError, setQuoteError\] = useState\(false\)/);
  assert.match(src, /setQuoteError\(false\)[^]*setQuoteLoading\(true\)/);
  assert.match(src, /if \(!res\.ok\)[^]*setQuoteError\(true\)/);
  assert.match(src, /quoteError \? \([^]*가격 정보를 불러올 수 없습니다/);
});

test('행정구역 master 미임포트 시 자유입력이나 상담 우회 없이 목록형 지역선택을 잠근다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  const region = read('src/components/booking/RegionSelect.tsx');
  assert.match(region, /onImportedChange\?: \(imported: boolean\) => void/);
  assert.match(region, /onImportedChange\?\.\(false\)/);
  assert.match(form, /const \[regionMasterImported, setRegionMasterImported\] = useState<boolean \| null>\(null\)/);
  assert.match(form, /regionMasterImported === false/);
  assert.doesNotMatch(form, /manualAreaText/);
  assert.doesNotMatch(region, /manualValue|onManualChange|placeholder="예: 서울 강남구 역삼동"/);
  assert.match(region, /imported === false[^]*시\/도 선택[^]*시\/군\/구 선택[^]*읍\/면\/동 선택/);
  assert.match(form, /공식 행정구역 목록을 준비 중입니다/);
});

test('예약 API도 행정구역 master 미임포트 상태의 직접예약을 거부한다', () => {
  const api = read('src/app/api/reservations/route.ts');
  assert.match(api, /getReservationAreaStatus/);
  assert.match(api, /!areaStatus\.masterReady[^]*REGION_MASTER_NOT_READY/);
  assert.doesNotMatch(api, /countAreas/);
  assert.doesNotMatch(api, /미임포트 상태에서 모든 예약을 막으면 서비스가 중단되므로 통과시킨다/);
});


test('사이청소 all_day 보호를 재개방할 때 all_day 예약 자체는 슬롯 capacity를 소진하지 않는다', () => {
  const calendar = read('src/lib/calendar.ts');
  const repo = read('src/database/repositories/calendar-repository.ts');
  assert.match(repo, /countDirectActiveReservationsOnSlot/);
  assert.match(calendar, /countDirectActiveReservationsOnSlot\(date, timeSlot\)/);
  assert.match(calendar, /blockedByAllDay && reopened \? directBookedCount : bookedCount/);
  assert.match(calendar, /const directBookedCount = activeCounts\.get\(`\$\{date\}\|\$\{timeSlot\}`\) \?\? 0/);
});

test('재개방 슬롯의 예약금 공개·확정·시간변경은 all_day 보호 예약을 capacity 점유로 세지 않는다', () => {
  const domain = read('src/lib/reservations.ts');
  const repo = read('src/database/repositories/reservation-repository.ts');
  assert.match(repo, /countDirectActiveReservationsOnSlotExcluding/);
  const directUses = domain.match(/slotView\.reopened[\s\S]{0,220}countDirectActiveReservationsOnSlotExcluding/g) ?? [];
  assert.ok(directUses.length >= 3, `재개방 슬롯 직접예약 카운트 사용처가 부족합니다: ${directUses.length}`);
});

test('사이청소 선택 시 좌측 캘린더도 오전/오후 대신 날짜 단위 선택만 사용한다', () => {
  const section = read('src/components/booking/BookingSection.tsx');
  const form = read('src/components/booking/BookingForm.tsx');
  const calendar = read('src/components/booking/ReservationCalendar.tsx');

  assert.match(form, /onServiceChange\?: \(serviceType: ServiceType\) => void/);
  assert.match(form, /selectedDate\?: string \| null/);
  assert.match(form, /onServiceChange\?\.\(nextService\)/);
  assert.match(section, /const \[activeService, setActiveService\] = useState<ServiceType>\(SERVICE_TYPES\[0\]\)/);
  assert.match(section, /dateOnly=\{activeService === "사이청소"\}/);
  assert.match(section, /onSelectDate=\{handleSelectDate\}/);
  assert.match(section, /selectedDate=\{selectedDate\}/);
  assert.match(calendar, /dateOnly\?: boolean/);
  assert.match(calendar, /onSelectDate\?: \(date: string\) => void/);
  assert.match(calendar, /const dateSelectable = Boolean\(!day\?\.allDayBlocked && morning\?\.selectable && afternoon\?\.selectable\)/);
  assert.match(calendar, /dateOnly \? \([^]*onSelectDate\?\.\(dateStr\)[^]*\) : \([^]*오전[^]*오후/);
});

test('사이청소 날짜 선택은 기존 all_day 보호 예약이 있는 날을 재개방 여부와 무관하게 다시 선택하지 않는다', () => {
  const calendar = read('src/components/booking/ReservationCalendar.tsx');
  assert.match(calendar, /const dateSelectable = Boolean\(!day\?\.allDayBlocked && morning\?\.selectable && afternoon\?\.selectable\)/);
});


test('1단계 맨 앞에서 지역을 먼저 선택하고 지역 확인 전에는 가격 조회를 시작하지 않는다', () => {
  const src = read('src/components/booking/BookingForm.tsx');
  const step1 = src.match(/\{step === 1 && \([\s\S]*?\n      \)\}/)?.[0] ?? src;
  assert.match(src, /const STEP_LABELS = \["지역·서비스", "날짜", "고객정보", "확인·동의"\]/);
  assert.match(step1, /<RegionSelect/);
  assert.match(step1, /청소 종류/);
  assert.ok(step1.indexOf('<RegionSelect') < step1.indexOf('청소 종류'), '지역 선택 UI가 서비스 선택보다 먼저여야 한다');
  assert.match(src, /const regionReadyForPricing =/);
  assert.match(src, /if \(!regionReadyForPricing \|\| !hasProduct \|\| !desiredDate\)/);
});

test('고객정보 단계에서는 지역과 상세주소를 다시 입력하지 않고 작업 장소를 요약한다', () => {
  const src = read('src/components/booking/BookingForm.tsx');
  const step3 = src.match(/\{step === 3 && \([\s\S]*?\n      \)\}/)?.[0] ?? '';
  assert.doesNotMatch(step3, /<RegionSelect/);
  assert.doesNotMatch(step3, /<Field label="상세 주소"/);
  assert.match(step3, /작업 장소/);
  assert.match(step3, /address\.trim\(\)/);
});

test('기본가격은 공개 가격표를 한 번 캐시해 즉시 표시하고 날짜 선택 후에만 최종 quote를 갱신한다', () => {
  const src = read('src/components/booking/BookingForm.tsx');
  assert.match(src, /fetch\("\/api\/pricing"\)/);
  assert.match(src, /const \[priceCatalog, setPriceCatalog\]/);
  assert.match(src, /const baseCatalogQuote:\s*Quote \| null =/);
  assert.match(src, /desiredDate \? \(quote \?\? baseCatalogQuote\) : baseCatalogQuote/);
});

test('행정구역 master 미임포트 시에도 첫 화면은 3단 목록 UI를 유지하고 자유입력을 만들지 않는다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  const region = read('src/components/booking/RegionSelect.tsx');
  assert.doesNotMatch(region, /manualValue|onManualChange/);
  assert.doesNotMatch(region, /<input[^>]+type="text"/);
  assert.match(region, /작업 장소/);
  assert.match(region, /시\/도 선택/);
  assert.match(region, /시\/군\/구 선택/);
  assert.match(region, /읍\/면\/동 선택/);
  assert.match(form, /const showRegionConsultNotice =/);
  assert.match(form, /const showRegionConsultNotice = region\.serviceAvailable === false/);
  assert.match(form, /showRegionConsultNotice/);
  assert.doesNotMatch(form, /현재는 상담 접수로 전환됩니다/);
});
