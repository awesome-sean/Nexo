import { getTrafficLightState, type TrafficState, type TrafficSnapshot } from '../../../common/codex-traffic';
import React from 'react';

interface Props {
  time: string;
  date: string;
  five: number | null;
  week: number | null;
  fiveReset: string;
  weekReset: string;
  cny: number | null;
  partial: boolean;
  traffic?: TrafficState;
  trafficSnapshot?: TrafficSnapshot;
  screenWidth?: number;
  screenHeight?: number;
}

const names: Record<string, string> = { ':': 'colon', '/': 'slash', '-': 'dash', '.': 'dot', ' ': 'blank' };

export const Band9Preview: React.FC<Props> = ({ time, date, five, week, fiveReset, weekReset, cny, partial, traffic = 'idle', trafficSnapshot, screenWidth = 192, screenHeight = 490 }) => {
  const displayTraffic = getTrafficLightState(trafficSnapshot);
  const logicalHeight = screenHeight * 192 / screenWidth;
  const scale = Math.min(1, logicalHeight / 490);
  const landscapeOffset = screenWidth === 212 && screenHeight === 520 ? 6 * 192 / screenWidth : 0;
  const rect = (x: number, y: number, width: number, height: number): React.CSSProperties => ({
    position: 'absolute', left: 192 - (y + 3) - height, top: x, width: height, height: width,
  });
  const image = (name: string, x: number, y: number, width: number, height: number) => (
    <img key={name + x + y} src={`./band9/${name}.png`} alt="" style={rect(x, y, width, height)} />
  );
  const digits = (kind: string, text: string, x: number, y: number, width: number, height: number) => (
    [...text].map((character, index) => image(`${kind}-${names[character] ?? character}`, x + index * width, y, width, height))
  );
  let money = '--';
  if (cny !== null) money = cny >= 1000000 ? `${(cny / 1000000).toFixed(1)}m` : cny >= 10000 ? `${(cny / 10000).toFixed(1)}w` : cny.toFixed(2);
  let moneyPosition = 109;
  const moneyImages = [...money.padEnd(7, ' ')].map((character) => {
    const width = character === '.' ? 4 : 12;
    const layer = image(`money-${names[character] ?? character}`, moneyPosition, 134, width, 30);
    moneyPosition += width;
    return layer;
  });
  return (
    <div role="img" aria-label={`手环横屏预览，${time}，5 小时剩余 ${five ?? '未知'}%，每周剩余 ${week ?? '未知'}%，今日估算 ${cny ?? '未知'}元`}
      style={{ width: logicalHeight, height: 192, position: 'relative', borderRadius: 96, overflow: 'hidden', background: '#000', flexShrink: 0 }}>
      <div style={{ width: 490, height: 192, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', left: -landscapeOffset, top: (192 - 192 * scale) / 2 }}>
      <div style={{ width: 192, height: 490, position: 'absolute', left: 149, top: -149, transform: 'rotate(-90deg)', background: '#000' }}>
        {image(`status-${trafficSnapshot ? displayTraffic : traffic}`, 14, 88, 16, 16)}
        {image(`clock-${time[0]}`, 38, 10, 41, 90)}
        {image(`clock-${time[1]}`, 79, 10, 41, 90)}
        {image('clock-colon', 120, 10, 16, 90)}
        {image(`clock-${time[3]}`, 136, 10, 41, 90)}
        {image(`clock-${time[4]}`, 177, 10, 41, 90)}
        {[43, 69, 95, 109, 135].map((x, index) => image(`date-${names[date[index]] ?? date[index]}`, x, 83, index === 2 ? 14 : 26, 54))}
        {image(partial ? 'money-partial' : 'money-label', 50, 134, 32, 30)}
        {image(partial ? 'money-symbol-partial' : 'money-symbol', 83, 134, 24, 30)}
        {moneyImages}
        {image(`ring-five-${five ?? 'unknown'}`, 232, 18, 116, 116)}
        {image(`ring-week-${week ?? 'unknown'}`, 358, 18, 116, 116)}
        {image('reset-label', 247, 141, 28, 28)}
        {image('reset-label', 373, 141, 28, 28)}
        {digits('small', fiveReset, 278, 141, 11, 28)}
        {digits('small', weekReset, 404, 141, 11, 28)}
      </div>
      </div>
    </div>
  );
};
