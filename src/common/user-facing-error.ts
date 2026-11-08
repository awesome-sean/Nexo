/** Convert technical transport errors into Nexo-facing messages. */
export function userFacingError(value: unknown): string {
  let message = value instanceof Error ? value.message : String(value ?? '操作失败');
  message = message.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '').replace(/^(?:Error:\s*)+/i, '');
  return message.replace(/pulse-core/gi, 'Nexo 设备服务').replace(/PulseDev/gi, 'Nexo').replace(/\bpulse\b/gi, 'Nexo');
}
