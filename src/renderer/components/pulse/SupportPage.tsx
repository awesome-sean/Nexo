import { useState } from 'react';
import { Check, Heart } from 'lucide-react';
import wechatCode from '../../assets/support/wechat.jpg';
import alipayCode from '../../assets/support/alipay.jpg';

const tiers = [
  { amount: '5', title: '一杯水', message: '小小鼓励，也很珍贵' },
  { amount: '15', title: '一杯奶茶', message: '为下一次更新加点甜' },
  { amount: '30', title: '一份简餐', message: '为项目迭代补充能量' },
  { amount: '50', title: '强力支持', message: '让长期维护更有动力' },
  { amount: 'custom', title: '任意金额', message: '随心支持，心意同样珍贵' },
];

export function SupportPage() {
  const [amount, setAmount] = useState('15');
  const [method, setMethod] = useState<'wechat' | 'alipay'>('wechat');
  return <div className="settings-information-page">
    <h2>打赏作者</h2>
    <section className="settings-support-card nexo-floating-settings-card">
      <span className="settings-support-icon"><Heart size={30} strokeWidth={1.5} /></span>
      <h3>请我喝一杯，让 Nexo 继续生长</h3>
      <p>如果 Nexo 帮你少一分等待、多一分从容，欢迎请我喝一杯。<br />你的每一份支持，都会成为持续维护与更新的动力。</p>
      <div className="support-tiers" role="group" aria-label="打赏档位">
        {tiers.map(tier => <button type="button" key={tier.amount} aria-pressed={amount === tier.amount} onClick={() => setAmount(tier.amount)}>
          <span className="support-tier-amount">{tier.amount === 'custom' ? '随心' : `¥${tier.amount}`}{amount === tier.amount && <Check size={18} />}</span>
          <strong>{tier.title}</strong><span>{tier.message}</span>
        </button>)}
      </div>
      <div className="support-payment">
        <div className="support-payment-copy"><h4>扫码支持</h4><p>{amount === 'custom' ? '扫码后填写任意金额。' : `扫码后填写 ¥${amount}，感谢你的心意。`}</p><span>心意不分大小，感谢你与 Nexo 同行。</span></div>
        <div className="support-payment-code">
          <div className="support-methods" role="group" aria-label="收款方式"><button type="button" aria-pressed={method === 'wechat'} onClick={() => setMethod('wechat')}>微信</button><button type="button" aria-pressed={method === 'alipay'} onClick={() => setMethod('alipay')}>支付宝</button></div>
          <div className="support-qr"><img src={method === 'wechat' ? wechatCode : alipayCode} alt={method === 'wechat' ? '微信收款码' : '支付宝收款码'} /><span>使用{method === 'wechat' ? '微信' : '支付宝'}扫一扫</span></div>
        </div>
      </div>
    </section>
  </div>;
}
