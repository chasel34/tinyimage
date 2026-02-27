import { List, Toast, showToast } from "@raycast/api";
import { useEffect, useState } from "react";
import { CompressionSettingsForm } from "./components/CompressionSettingsForm";
import {
  createDefaultCompressionSettings,
  loadDefaultCompressionSettings,
  saveDefaultCompressionSettings,
} from "./lib/settings";
import { CompressionSettingsV1 } from "./types";

export default function OpenCompressionSettingsCommand() {
  const [settings, setSettings] = useState<CompressionSettingsV1 | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const stored = await loadDefaultCompressionSettings();
        if (!disposed) {
          setSettings(stored ?? createDefaultCompressionSettings());
        }
      } finally {
        if (!disposed) setIsLoading(false);
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  async function handleSaveDefaults(nextSettings: CompressionSettingsV1): Promise<boolean> {
    await saveDefaultCompressionSettings(nextSettings);
    setSettings(nextSettings);
    await showToast({ style: Toast.Style.Success, title: "Default settings saved" });
    return true;
  }

  if (isLoading || !settings) {
    return <List isLoading navigationTitle="Default Compression Settings" />;
  }

  return (
    <CompressionSettingsForm
      navigationTitle="Default Compression Settings"
      submitTitle="Save Default Settings"
      initialSettings={settings}
      onSubmitSettings={handleSaveDefaults}
    />
  );
}
