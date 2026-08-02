import {
  isProviderEnabled,
  setProviderEnabled,
  USAGE_PROVIDERS,
  useProviderPrefs,
} from "@/features/provider-usage/providerPrefs";
import {
  SettingsOptionGroup,
  SettingsOptionRow,
} from "@/features/settings/ui/SettingsOptionGroup";
import { SettingsSectionHeader } from "@/features/settings/ui/SettingsSectionHeader";
import { useFeatureEnabled } from "@/shared/features/useFeatureEnabled";
import { Switch } from "@/shared/ui/switch";

/**
 * Per-provider toggles for the sidebar AI usage card. Renders under the
 * Experiments panel and only while the `providerUsage` preview feature is on,
 * so the toggles appear right next to the flag that reveals them.
 */
export function ProviderUsageSettingsCard() {
  const featureOn = useFeatureEnabled("providerUsage");
  const prefs = useProviderPrefs();

  if (!featureOn) {
    return null;
  }

  return (
    <section className="min-w-0" data-testid="settings-provider-usage">
      <SettingsSectionHeader
        title="AI usage card"
        description="Choose which subscriptions the sidebar usage card tracks. Providers you add later start enabled."
      />
      <SettingsOptionGroup>
        {USAGE_PROVIDERS.map((provider) => {
          const switchId = `provider-usage-switch-${provider.id}`;
          return (
            <SettingsOptionRow key={provider.id}>
              <label className="text-sm font-medium" htmlFor={switchId}>
                {provider.label}
              </label>
              <Switch
                checked={isProviderEnabled(prefs, provider.id)}
                data-testid={`provider-usage-toggle-${provider.id}`}
                id={switchId}
                onCheckedChange={(value) =>
                  setProviderEnabled(provider.id, value)
                }
              />
            </SettingsOptionRow>
          );
        })}
      </SettingsOptionGroup>
    </section>
  );
}
