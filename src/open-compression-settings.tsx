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
    await showToast({ style: Toast.Style.Success, title: "默认设置已保存" });
    return true;
  }

  if (isLoading || !settings) {
    return <List isLoading navigationTitle="默认压缩设置" />;
  }

  return (
    <CompressionSettingsForm
      navigationTitle="默认压缩设置"
      submitTitle="保存默认设置"
      initialSettings={settings}
      onSubmitSettings={handleSaveDefaults}
    />
  );
}
