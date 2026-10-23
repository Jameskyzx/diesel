import type { Locale } from "@/i18n/locale";
import type {
  FeedbackCategory,
  FeedbackSeverity,
  FeedbackSourceKind,
  FeedbackSystem,
} from "@/features/feedback/schemas";

type Label = { en: string; zh: string };

export const feedbackCategoryLabels: Record<FeedbackCategory, Label> = {
  failure: { en: "Failure", zh: "故障" },
  quality: { en: "Quality / assembly", zh: "质量 / 装配" },
  performance_request: { en: "Performance request", zh: "性能需求" },
  service_parts: { en: "Service / parts", zh: "服务 / 配件" },
  commercial: { en: "Price / delivery", zh: "价格 / 交期" },
  documentation: { en: "Documents / certificates", zh: "资料 / 认证" },
  other: { en: "Other", zh: "其他" },
};

export const feedbackSystemLabels: Record<FeedbackSystem, Label> = {
  intake: { en: "Intake", zh: "进气" },
  exhaust: { en: "Exhaust", zh: "排气" },
  aftertreatment: { en: "Aftertreatment", zh: "后处理" },
  fuel: { en: "Fuel", zh: "燃油" },
  cooling: { en: "Cooling", zh: "冷却" },
  lubrication: { en: "Lubrication", zh: "润滑" },
  electronics: { en: "Electronics", zh: "电控" },
  power_output: { en: "Power output", zh: "动力输出" },
  structure: { en: "Structure / NVH", zh: "结构 / 噪声振动" },
  other: { en: "Other", zh: "其他" },
};

export const feedbackSeverityLabels: Record<FeedbackSeverity, Label> = {
  low: { en: "Low", zh: "低" },
  medium: { en: "Medium", zh: "中" },
  high: { en: "High", zh: "高" },
  safety: { en: "Safety-related", zh: "安全相关" },
};

export const feedbackSourceKindLabels: Record<FeedbackSourceKind, Label> = {
  chat_screenshot: { en: "Chat screenshot", zh: "聊天截图" },
  paper_photo: { en: "Paper photo", zh: "纸质照片" },
  pdf: { en: "PDF", zh: "PDF" },
  email: { en: "E-mail", zh: "邮件" },
  text: { en: "Text", zh: "文字" },
};

export function feedbackLabel(labels: Record<string, Label>, key: string, locale: Locale): string {
  const label = labels[key];
  return label ? locale === "zh-CN" ? label.zh : label.en : key;
}
