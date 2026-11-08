import React, { useEffect, useState } from 'react';

export const UsageEstimateSettings: React.FC = () => {
  const [rate, setRate] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    window.pulse
      ?.getExchangeRate()
      .then((value) => {
        if (alive) setRate(String(value));
      })
      .catch(() => {
        if (alive) setMessage('汇率读取失败');
      });
    return () => {
      alive = false;
    };
  }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!window.pulse) {
      setMessage('桌面连接未就绪');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const value = await window.pulse.setExchangeRate(Number(rate));
      setRate(String(value));
      setMessage('已保存，估算金额会随下一次同步更新');
    } catch (error: any) {
      setMessage(error?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="rounded-[10px] bg-[var(--bg-subtle)] p-3.5">
      <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
        今日费用估算
      </h3>
      <details className="mt-3">
        <summary>计算说明</summary>
        <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
          本机 Codex 日志 × 标准 API
          标价。按输入、缓存输入与输出分别计算，缓存写入采用 30 分钟价。
          价格表核对日期为 2026-11-06。缺失日志或未定价模型会标记为部分估算。
        </p>
      </details>
      <form onSubmit={save} className="flex items-end gap-2 mt-3">
        <label className="flex-1 text-[12px] text-[var(--text-secondary)]">
          汇率 · 1 美元兑人民币
          <input
            aria-label="美元兑人民币手动汇率"
            type="number"
            min="0.0001"
            max="1000"
            step="0.0001"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 text-[var(--text-primary)]"
          />
        </label>
        <button
          type="submit"
          disabled={saving || !rate}
          className="btn-primary rounded-lg px-3 py-2 text-[14px] disabled:opacity-50"
        >
          {saving ? '保存中' : '保存'}
        </button>
      </form>
      {message && (
        <p role="status" className="text-[12px] text-[var(--text-muted)] mt-2">
          {message}
        </p>
      )}
    </section>
  );
};
