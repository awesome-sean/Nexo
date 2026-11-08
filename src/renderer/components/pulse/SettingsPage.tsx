import { UsageEstimateSettings } from './UsageEstimateSettings';
import { AutoLaunchSettings } from './AutoLaunchSettings';

export function SettingsPage() {
  return <div className="nexo-page nexo-settings-page">
    <div className="nexo-page-header"><h1 className="nexo-page-title">偏好设置</h1></div>
    <div className="nexo-settings-grid"><div className="nexo-settings-stack">
      <UsageEstimateSettings />
      <AutoLaunchSettings />
    </div></div>
  </div>;
}
