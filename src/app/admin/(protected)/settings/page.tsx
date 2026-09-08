"use client";

import { useEffect, useState } from "react";

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data.settings || {}))
      .finally(() => setLoading(false));
  }, []);

  function set(key: string, value: string) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setMessage("저장되었습니다.");
      } else {
        setMessage("저장 중 오류가 발생했습니다.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft)]">불러오는 중...</p>;

  // 예약 접수 준비상태: 선입금 금액 + 계좌 정보가 모두 입력됐는지 확인
  const depositAmount = Number(settings.deposit_amount || 0);
  const bankReady = !!(settings.bank_name && settings.bank_account_number && settings.bank_account_holder);
  const reservationReady = depositAmount > 0 && bankReady;

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-xl font-bold">요금 / 계좌 / 회사 정보 설정</h1>
      <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
        선입금 금액과 계좌 정보를 입력하면 고객 예약 접수가 시작됩니다.
        가격관리는 <a href="/admin/pricing" className="text-[var(--mint)] hover:underline">가격 설정 페이지</a>에서 진행하세요.
      </p>

      {reservationReady ? (
        <div className="mt-5 rounded-xl bg-[var(--mint-soft)] px-4 py-3 text-sm text-[var(--mint)]">
          ✓ 예약 접수 준비 완료
        </div>
      ) : (
        <div className="mt-5 rounded-xl bg-[#FBE9D3] px-4 py-3 text-sm text-[var(--amber)]">
          {!bankReady && "은행명·계좌번호·예금주를 입력해주세요. "}
          {depositAmount <= 0 && "선입금 금액을 설정해주세요."}
        </div>
      )}

      {message && (
        <div className="mt-4 rounded-lg bg-[var(--mint-soft)] px-4 py-3 text-sm text-[var(--mint)]">
          {message}
        </div>
      )}

      <SectionBlock title="선입금 / 할인 설정">
        <NumberField
          label="선입금 금액 (원)"
          value={settings.deposit_amount}
          onChange={(v) => set("deposit_amount", v)}
        />
        <NumberField
          label="즉시예약 할인 금액"
          value={settings.instant_discount_amount}
          onChange={(v) => set("instant_discount_amount", v)}
        />
        <TextAreaField
          label="잔금 안내 문구"
          value={settings.balance_notice}
          onChange={(v) => set("balance_notice", v)}
        />
      </SectionBlock>

      <SectionBlock title="입금 계좌 정보">
        <TextField label="은행명" value={settings.bank_name} onChange={(v) => set("bank_name", v)} />
        <TextField
          label="계좌번호"
          value={settings.bank_account_number}
          onChange={(v) => set("bank_account_number", v)}
        />
        <TextField
          label="예금주"
          value={settings.bank_account_holder}
          onChange={(v) => set("bank_account_holder", v)}
        />
        <NumberField
          label="입금 기한 (시간)"
          value={settings.payment_due_hours}
          onChange={(v) => set("payment_due_hours", v)}
        />
      </SectionBlock>

      <SectionBlock title="회사 정보">
        <TextField label="회사명" value={settings.company_name} onChange={(v) => set("company_name", v)} />
        <TextField label="전화번호" value={settings.company_phone} onChange={(v) => set("company_phone", v)} />
        <TextField
          label="카카오톡 채널 URL"
          value={settings.company_kakao_url}
          onChange={(v) => set("company_kakao_url", v)}
        />
        <TextField label="주소" value={settings.company_address} onChange={(v) => set("company_address", v)} />
        <TextField
          label="사업자등록번호"
          value={settings.company_biz_number}
          onChange={(v) => set("company_biz_number", v)}
        />
      </SectionBlock>

      <SectionBlock title="SEO 기본 설정">
        <TextField label="사이트 제목" value={settings.site_title} onChange={(v) => set("site_title", v)} />
        <TextAreaField
          label="사이트 설명 (meta description)"
          value={settings.site_description}
          onChange={(v) => set("site_description", v)}
        />
      </SectionBlock>

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-6 rounded-full bg-[var(--navy)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--navy-deep)] disabled:opacity-60"
      >
        {saving ? "저장 중..." : "설정 저장"}
      </button>
    </div>
  );
}

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-7 rounded-2xl border border-[var(--line)] bg-white p-5">
      <p className="mb-4 text-sm font-semibold">{title}</p>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
      />
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
      />
    </div>
  );
}
