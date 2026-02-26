import { Action, ActionPanel, Form, Toast, showToast, useNavigation } from "@raycast/api";
import { useMemo, useState } from "react";
import { normalizeCompressionSettings } from "../lib/settings";
import { CompressionSettingsFormValues, CompressionSettingsV1, TargetFormat } from "../types";

interface CompressionSettingsFormProps {
  navigationTitle: string;
  submitTitle: string;
  initialSettings: CompressionSettingsV1;
  onSubmitSettings: (settings: CompressionSettingsV1) => Promise<boolean | void> | boolean | void;
  popOnSubmit?: boolean;
}

function formatLabelForTargetFormat(targetFormat: TargetFormat): string {
  switch (targetFormat) {
    case "jpeg":
      return "JPEG";
    case "png":
      return "PNG";
    case "webp":
      return "WebP";
    case "avif":
      return "AVIF";
  }
}

export function CompressionSettingsForm(props: CompressionSettingsFormProps) {
  const { navigationTitle, submitTitle, initialSettings, onSubmitSettings, popOnSubmit } = props;
  const { pop } = useNavigation();
  const [formatMode, setFormatMode] = useState(initialSettings.formatMode);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const initialValues = useMemo<CompressionSettingsFormValues>(
    () => ({
      outputMode: initialSettings.outputMode,
      formatMode: initialSettings.formatMode,
      targetFormat: initialSettings.targetFormat,
      quality: String(initialSettings.quality),
      pngCompressionLevel: String(initialSettings.pngCompressionLevel),
      keepMetadata: initialSettings.keepMetadata,
    }),
    [initialSettings],
  );

  async function handleSubmit(values: CompressionSettingsFormValues): Promise<boolean> {
    const quality = Number(values.quality);
    const pngCompressionLevel = Number(values.pngCompressionLevel);

    if (!Number.isFinite(quality)) {
      await showToast({ style: Toast.Style.Failure, title: "质量必须是数字", message: "请输入 1-100" });
      return false;
    }

    if (!Number.isFinite(pngCompressionLevel)) {
      await showToast({ style: Toast.Style.Failure, title: "PNG 压缩级别必须是数字", message: "请输入 0-9" });
      return false;
    }

    const normalized = normalizeCompressionSettings({
      ...initialSettings,
      outputMode: values.outputMode,
      formatMode: values.formatMode,
      targetFormat: values.targetFormat ?? initialSettings.targetFormat,
      quality,
      pngCompressionLevel,
      keepMetadata: values.keepMetadata,
    });

    setIsSubmitting(true);
    try {
      const result = await onSubmitSettings(normalized);
      if (result === false) return false;
      if (popOnSubmit) {
        pop();
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存设置失败";
      await showToast({ style: Toast.Style.Failure, title: "保存设置失败", message });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      navigationTitle={navigationTitle}
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={submitTitle} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="outputMode" title="输出方式" defaultValue={initialValues.outputMode}>
        <Form.Dropdown.Item value="generate-new" title="生成新图" />
        <Form.Dropdown.Item value="overwrite-original" title="覆盖原图" />
      </Form.Dropdown>

      <Form.Dropdown
        id="formatMode"
        title="格式模式"
        defaultValue={initialValues.formatMode}
        onChange={(newValue) => setFormatMode(newValue as CompressionSettingsV1["formatMode"])}
      >
        <Form.Dropdown.Item value="keep-original" title="保持原格式压缩" />
        <Form.Dropdown.Item value="convert" title="统一转换格式" />
      </Form.Dropdown>

      {formatMode === "convert" ? (
        <Form.Dropdown id="targetFormat" title="目标格式" defaultValue={initialValues.targetFormat}>
          {(["jpeg", "png", "webp", "avif"] as const).map((targetFormat) => (
            <Form.Dropdown.Item
              key={targetFormat}
              value={targetFormat}
              title={formatLabelForTargetFormat(targetFormat)}
            />
          ))}
        </Form.Dropdown>
      ) : null}

      <Form.TextField id="quality" title="质量 (1-100)" defaultValue={initialValues.quality} placeholder="80" />

      <Form.Dropdown
        id="pngCompressionLevel"
        title="PNG 压缩级别 (0-9)"
        defaultValue={initialValues.pngCompressionLevel}
      >
        {Array.from({ length: 10 }, (_, value) => String(value)).map((value) => (
          <Form.Dropdown.Item key={value} value={value} title={value} />
        ))}
      </Form.Dropdown>

      <Form.Checkbox
        id="keepMetadata"
        title="元数据"
        label="保留 EXIF / ICC 等元数据"
        defaultValue={initialValues.keepMetadata}
      />
    </Form>
  );
}

export default CompressionSettingsForm;
