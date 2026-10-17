import { z } from "zod";

import type { ApplicationScope } from "@/features/database/schemas";
import type { CatalogCategory } from "@/features/product-catalog/schemas";

/**
 * Customer-brief languages. Only the fixed template is translated; regulation
 * names, citation codes and source titles stay in their source language.
 * Template translations should be reviewed by a native speaker before a brief
 * is sent to a customer.
 */
export const briefLanguages = ["en", "zh-CN", "es", "pt-BR", "ru", "ar"] as const;
export const briefLanguageSchema = z.enum(briefLanguages);
export type BriefLanguage = z.infer<typeof briefLanguageSchema>;

export function briefDirection(language: BriefLanguage): "ltr" | "rtl" {
  return language === "ar" ? "rtl" : "ltr";
}

type BriefCopy = {
  languageName: string;
  kw: (value: string) => string;
  title: (country: string) => string;
  conditions: { market: string; application: string; power: string; asOf: string };
  sections: { regulations: string; candidates: string; nextSteps: string; notes: string };
  regulation: { citation: string; status: string; effective: string; superseded: string; validity: (from: string, to: string | null) => string; source: string; verified: (date: string) => string };
  candidate: { model: string; rating: (kw: string, rpm: string) => string; band: (min: string, max: string) => string; declaration: string; covers: string; aftertreatment: string };
  noRegulations: string;
  noCandidates: string;
  gapNote: (count: number) => string;
  nextSteps: readonly string[];
  notes: { fictional: string; notCertification: string; sourceLanguage: string; realRegulations: string; noData: string };
  generated: (date: string, ruleset: string) => string;
  scopes: Record<ApplicationScope, string>;
  categories: Record<CatalogCategory, string>;
};

export const customerBriefCopy: Record<BriefLanguage, BriefCopy> = {
  en: {
    kw: value => `${value} kW`,
    languageName: "English",
    title: country => `Emission compliance brief — ${country}`,
    conditions: { market: "Target market", application: "Application", power: "Required power", asOf: "Regulations in force on" },
    sections: { regulations: "Applicable emission regulations", candidates: "Candidate engines", nextSteps: "Documents to confirm before ordering", notes: "Important notes" },
    regulation: { citation: "Citation", status: "Status", effective: "In force", superseded: "Superseded later, in force on this date", validity: (from, to) => `Valid from ${from}${to ? ` until ${to}` : ""}`, source: "Source", verified: date => `Source verified ${date}` },
    candidate: { model: "Model", rating: (kw, rpm) => `Rated ${kw} kW at ${rpm} r/min`, band: (min, max) => `Rating band ${min}–${max} kW`, declaration: "Declared emission standard", covers: "Declared to meet", aftertreatment: "Aftertreatment" },
    noRegulations: "No emission regulation in force is recorded for these conditions. This does not mean there are no requirements; please let us confirm with the local authority.",
    noCandidates: "No catalogue engine declares every applicable regulation. We can discuss homologation options for your project.",
    gapNote: count => `${count} further model(s) fit the application and power but do not declare every applicable regulation; they are not listed here.`,
    nextSteps: ["Type-approval or emission certificate for the exact engine configuration", "Emission test report under the test cycle required in the target market", "Engine nameplate and emission label requirements in the target market", "Confirmation of the regulation version and dates with the local authority"],
    notes: { fictional: "The engines in this brief come from a fictional demonstration catalogue and represent no manufacturer.", notCertification: "An emission declaration is not a certificate or market-entry approval. This brief is not legal advice.", sourceLanguage: "Regulation names and source titles are shown in their original language.", realRegulations: "Regulation records are taken from published sources; the engines are fictional, so this brief is a workflow demonstration and not a sales offer.", noData: "Missing regulation data is not evidence that no requirement exists." },
    generated: (date, ruleset) => `Prepared ${date} · deterministic ruleset ${ruleset}`,
    scopes: { "on-road": "On-road", "non-road": "Non-road machinery", marine: "Marine", "generator-set": "Generator set", agriculture: "Agricultural machinery", construction: "Construction machinery", "on-road-truck": "Truck", "on-road-bus": "Bus" },
    categories: { truck: "Truck", bus: "Bus", construction: "Construction machinery", agriculture: "Agricultural machinery", "generator-set": "Generator set", marine: "Marine" },
  },
  "zh-CN": {
    kw: value => `${value} kW`,
    languageName: "简体中文",
    title: country => `排放合规简报 — ${country}`,
    conditions: { market: "目标市场", application: "应用场景", power: "所需功率", asOf: "法规生效基准日" },
    sections: { regulations: "适用排放法规", candidates: "候选发动机", nextSteps: "下单前需确认的文件", notes: "重要说明" },
    regulation: { citation: "法规编号", status: "状态", effective: "生效中", superseded: "后被取代，基准日仍有效", validity: (from, to) => `自 ${from} 起有效${to ? `，至 ${to}` : ""}`, source: "来源", verified: date => `来源核验于 ${date}` },
    candidate: { model: "型号", rating: (kw, rpm) => `额定 ${kw} kW / ${rpm} r/min`, band: (min, max) => `可标定功率 ${min}–${max} kW`, declaration: "声明排放标准", covers: "声明符合", aftertreatment: "后处理" },
    noRegulations: "未收录该条件下生效的排放法规。这不代表没有要求，我们会与当地主管机构进一步确认。",
    noCandidates: "目录中没有型号声明覆盖全部适用法规。我们可以就项目讨论认证方案。",
    gapNote: count => `另有 ${count} 个型号符合用途和功率，但声明未覆盖全部适用法规，未列入本简报。`,
    nextSteps: ["对应发动机配置的型式核准或排放证书", "按目标市场要求测试循环出具的排放测试报告", "目标市场对发动机铭牌和排放标签的要求", "与当地主管机构确认法规版本和实施日期"],
    notes: { fictional: "本简报中的发动机来自虚构的演示目录，不代表任何制造商。", notCertification: "排放声明不是证书，也不是市场准入批准。本简报不构成法律意见。", sourceLanguage: "法规名称和来源标题保留原文语言。", realRegulations: "法规记录取自公开来源；发动机为虚构，因此本简报仅演示流程，不是销售报价。", noData: "缺少法规数据不能证明不存在相关要求。" },
    generated: (date, ruleset) => `生成于 ${date} · 确定性规则 ${ruleset}`,
    scopes: { "on-road": "道路", "non-road": "非道路机械", marine: "船用", "generator-set": "发电机组", agriculture: "农业机械", construction: "工程机械", "on-road-truck": "卡车", "on-road-bus": "客车" },
    categories: { truck: "卡车", bus: "客车", construction: "工程机械", agriculture: "农业机械", "generator-set": "发电机组", marine: "船用" },
  },
  es: {
    kw: value => `${value} kW`,
    languageName: "Español",
    title: country => `Informe de cumplimiento de emisiones — ${country}`,
    conditions: { market: "Mercado objetivo", application: "Aplicación", power: "Potencia requerida", asOf: "Normativa vigente al" },
    sections: { regulations: "Normativa de emisiones aplicable", candidates: "Motores candidatos", nextSteps: "Documentos a confirmar antes del pedido", notes: "Notas importantes" },
    regulation: { citation: "Referencia", status: "Estado", effective: "Vigente", superseded: "Sustituida después; vigente en esta fecha", validity: (from, to) => `Vigente desde ${from}${to ? ` hasta ${to}` : ""}`, source: "Fuente", verified: date => `Fuente verificada el ${date}` },
    candidate: { model: "Modelo", rating: (kw, rpm) => `Potencia nominal ${kw} kW a ${rpm} r/min`, band: (min, max) => `Rango de potencia ${min}–${max} kW`, declaration: "Norma de emisiones declarada", covers: "Declarado conforme a", aftertreatment: "Postratamiento" },
    noRegulations: "No consta ninguna normativa de emisiones vigente para estas condiciones. Esto no significa que no existan requisitos; lo confirmaremos con la autoridad local.",
    noCandidates: "Ningún motor del catálogo declara todas las normativas aplicables. Podemos estudiar opciones de homologación para su proyecto.",
    gapNote: count => `Otros ${count} modelo(s) se ajustan a la aplicación y la potencia, pero no declaran todas las normativas aplicables; no se incluyen aquí.`,
    nextSteps: ["Certificado de homologación o de emisiones de la configuración exacta del motor", "Informe de ensayo de emisiones según el ciclo exigido en el mercado objetivo", "Requisitos de placa del motor y etiqueta de emisiones en el mercado objetivo", "Confirmación de la versión y las fechas de la normativa con la autoridad local"],
    notes: { fictional: "Los motores de este informe proceden de un catálogo de demostración ficticio y no representan a ningún fabricante.", notCertification: "Una declaración de emisiones no es un certificado ni una autorización de comercialización. Este informe no constituye asesoramiento jurídico.", sourceLanguage: "Los nombres de las normativas y los títulos de las fuentes se muestran en su idioma original.", realRegulations: "Los registros normativos proceden de fuentes publicadas; los motores son ficticios, por lo que este informe es una demostración del proceso y no una oferta comercial.", noData: "La falta de datos normativos no demuestra que no exista ningún requisito." },
    generated: (date, ruleset) => `Elaborado el ${date} · reglas deterministas ${ruleset}`,
    scopes: { "on-road": "Carretera", "non-road": "Maquinaria móvil no de carretera", marine: "Marino", "generator-set": "Grupo electrógeno", agriculture: "Maquinaria agrícola", construction: "Maquinaria de construcción", "on-road-truck": "Camión", "on-road-bus": "Autobús" },
    categories: { truck: "Camión", bus: "Autobús", construction: "Maquinaria de construcción", agriculture: "Maquinaria agrícola", "generator-set": "Grupo electrógeno", marine: "Marino" },
  },
  "pt-BR": {
    kw: value => `${value} kW`,
    languageName: "Português (Brasil)",
    title: country => `Relatório de conformidade de emissões — ${country}`,
    conditions: { market: "Mercado-alvo", application: "Aplicação", power: "Potência necessária", asOf: "Regulamentação vigente em" },
    sections: { regulations: "Regulamentação de emissões aplicável", candidates: "Motores candidatos", nextSteps: "Documentos a confirmar antes do pedido", notes: "Observações importantes" },
    regulation: { citation: "Referência", status: "Situação", effective: "Em vigor", superseded: "Substituída depois; em vigor nesta data", validity: (from, to) => `Válida a partir de ${from}${to ? ` até ${to}` : ""}`, source: "Fonte", verified: date => `Fonte verificada em ${date}` },
    candidate: { model: "Modelo", rating: (kw, rpm) => `Potência nominal ${kw} kW a ${rpm} r/min`, band: (min, max) => `Faixa de potência ${min}–${max} kW`, declaration: "Norma de emissões declarada", covers: "Declarado conforme", aftertreatment: "Pós-tratamento" },
    noRegulations: "Não há regulamentação de emissões em vigor registrada para estas condições. Isso não significa ausência de requisitos; vamos confirmar com a autoridade local.",
    noCandidates: "Nenhum motor do catálogo declara todas as regulamentações aplicáveis. Podemos discutir opções de homologação para o seu projeto.",
    gapNote: count => `Outros ${count} modelo(s) atendem à aplicação e à potência, mas não declaram todas as regulamentações aplicáveis; não estão listados aqui.`,
    nextSteps: ["Certificado de homologação ou de emissões da configuração exata do motor", "Relatório de ensaio de emissões no ciclo exigido no mercado-alvo", "Requisitos de plaqueta do motor e etiqueta de emissões no mercado-alvo", "Confirmação da versão e das datas da regulamentação com a autoridade local"],
    notes: { fictional: "Os motores deste relatório vêm de um catálogo de demonstração fictício e não representam nenhum fabricante.", notCertification: "Uma declaração de emissões não é um certificado nem uma autorização de comercialização. Este relatório não constitui assessoria jurídica.", sourceLanguage: "Os nomes das regulamentações e os títulos das fontes aparecem no idioma original.", realRegulations: "Os registros regulatórios vêm de fontes publicadas; os motores são fictícios, portanto este relatório é uma demonstração do processo e não uma proposta comercial.", noData: "A falta de dados regulatórios não prova que não exista requisito." },
    generated: (date, ruleset) => `Preparado em ${date} · regras determinísticas ${ruleset}`,
    scopes: { "on-road": "Rodoviário", "non-road": "Máquinas móveis não rodoviárias", marine: "Marítimo", "generator-set": "Grupo gerador", agriculture: "Máquinas agrícolas", construction: "Máquinas de construção", "on-road-truck": "Caminhão", "on-road-bus": "Ônibus" },
    categories: { truck: "Caminhão", bus: "Ônibus", construction: "Máquinas de construção", agriculture: "Máquinas agrícolas", "generator-set": "Grupo gerador", marine: "Marítimo" },
  },
  ru: {
    kw: value => `${value} кВт`,
    languageName: "Русский",
    title: country => `Справка о соответствии экологическим нормам — ${country}`,
    conditions: { market: "Целевой рынок", application: "Применение", power: "Требуемая мощность", asOf: "Нормы, действующие на" },
    sections: { regulations: "Применимые экологические нормы", candidates: "Подходящие двигатели", nextSteps: "Документы для подтверждения до заказа", notes: "Важные примечания" },
    regulation: { citation: "Обозначение", status: "Статус", effective: "Действует", superseded: "Позже заменён; действует на эту дату", validity: (from, to) => `Действует с ${from}${to ? ` по ${to}` : ""}`, source: "Источник", verified: date => `Источник проверен ${date}` },
    candidate: { model: "Модель", rating: (kw, rpm) => `Номинальная мощность ${kw} кВт при ${rpm} об/мин`, band: (min, max) => `Диапазон мощности ${min}–${max} кВт`, declaration: "Заявленный экологический класс", covers: "Заявлено соответствие", aftertreatment: "Система нейтрализации" },
    noRegulations: "Для этих условий не зарегистрированы действующие экологические нормы. Это не означает отсутствия требований; мы уточним их у местного регулятора.",
    noCandidates: "Ни один двигатель каталога не заявлен как соответствующий всем применимым нормам. Мы можем обсудить варианты сертификации для вашего проекта.",
    gapNote: count => `Ещё ${count} модель(и) подходят по применению и мощности, но не заявляют соответствия всем применимым нормам; они здесь не указаны.`,
    nextSteps: ["Одобрение типа или экологический сертификат для точной комплектации двигателя", "Протокол испытаний на выбросы по циклу, требуемому на целевом рынке", "Требования целевого рынка к табличке двигателя и экологической маркировке", "Подтверждение редакции и сроков действия норм у местного регулятора"],
    notes: { fictional: "Двигатели в этой справке взяты из вымышленного демонстрационного каталога и не представляют ни одного производителя.", notCertification: "Декларация о выбросах не является сертификатом или разрешением на выход на рынок. Справка не является юридической консультацией.", sourceLanguage: "Названия норм и источников приведены на языке оригинала.", realRegulations: "Нормативные данные взяты из опубликованных источников; двигатели вымышлены, поэтому справка демонстрирует процесс и не является коммерческим предложением.", noData: "Отсутствие нормативных данных не доказывает отсутствие требований." },
    generated: (date, ruleset) => `Подготовлено ${date} · детерминированные правила ${ruleset}`,
    scopes: { "on-road": "Дорожная техника", "non-road": "Внедорожная техника", marine: "Судовые", "generator-set": "Генераторная установка", agriculture: "Сельскохозяйственная техника", construction: "Строительная техника", "on-road-truck": "Грузовик", "on-road-bus": "Автобус" },
    categories: { truck: "Грузовик", bus: "Автобус", construction: "Строительная техника", agriculture: "Сельскохозяйственная техника", "generator-set": "Генераторная установка", marine: "Судовые" },
  },
  ar: {
    kw: value => `${value} كيلوواط`,
    languageName: "العربية",
    title: country => `موجز الامتثال لمعايير الانبعاثات — ${country}`,
    conditions: { market: "السوق المستهدفة", application: "التطبيق", power: "القدرة المطلوبة", asOf: "اللوائح السارية في" },
    sections: { regulations: "لوائح الانبعاثات المطبقة", candidates: "المحركات المرشحة", nextSteps: "مستندات يجب تأكيدها قبل الطلب", notes: "ملاحظات مهمة" },
    regulation: { citation: "المرجع", status: "الحالة", effective: "سارية", superseded: "استُبدلت لاحقًا، وكانت سارية في هذا التاريخ", validity: (from, to) => `سارية من ${from}${to ? ` حتى ${to}` : ""}`, source: "المصدر", verified: date => `تم التحقق من المصدر في ${date}` },
    candidate: { model: "الطراز", rating: (kw, rpm) => `القدرة الاسمية ${kw} كيلوواط عند ${rpm} دورة/دقيقة`, band: (min, max) => `نطاق القدرة ${min}–${max} كيلوواط`, declaration: "معيار الانبعاثات المُعلن", covers: "مُعلن مطابقته لـ", aftertreatment: "المعالجة اللاحقة" },
    noRegulations: "لا توجد لائحة انبعاثات سارية مسجلة لهذه الشروط. هذا لا يعني عدم وجود متطلبات؛ سنتحقق من ذلك مع الجهة المحلية المختصة.",
    noCandidates: "لا يوجد محرك في الكتالوج مُعلن مطابقته لجميع اللوائح المطبقة. يمكننا مناقشة خيارات الاعتماد لمشروعكم.",
    gapNote: count => `هناك ${count} طراز(ات) أخرى تناسب التطبيق والقدرة، لكنها لا تعلن المطابقة لجميع اللوائح المطبقة؛ ولم تُدرج هنا.`,
    nextSteps: ["شهادة اعتماد النوع أو شهادة الانبعاثات للتكوين المحدد للمحرك", "تقرير اختبار الانبعاثات وفق دورة الاختبار المطلوبة في السوق المستهدفة", "متطلبات لوحة بيانات المحرك وملصق الانبعاثات في السوق المستهدفة", "تأكيد إصدار اللائحة وتواريخ سريانها مع الجهة المحلية المختصة"],
    notes: { fictional: "المحركات الواردة في هذا الموجز مأخوذة من كتالوج عرض توضيحي خيالي ولا تمثل أي جهة مصنّعة.", notCertification: "إعلان الانبعاثات ليس شهادة ولا موافقة على دخول السوق. ولا يُعد هذا الموجز استشارة قانونية.", sourceLanguage: "تُعرض أسماء اللوائح وعناوين المصادر بلغتها الأصلية.", realRegulations: "سجلات اللوائح مأخوذة من مصادر منشورة؛ أما المحركات فخيالية، لذا فهذا الموجز عرض توضيحي لسير العمل وليس عرضًا تجاريًا.", noData: "غياب بيانات اللوائح لا يثبت عدم وجود متطلبات." },
    generated: (date, ruleset) => `أُعدّ في ${date} · قواعد حتمية ${ruleset}`,
    scopes: { "on-road": "المركبات على الطرق", "non-road": "الآلات غير الطرقية", marine: "بحري", "generator-set": "مولّد كهربائي", agriculture: "الآلات الزراعية", construction: "آلات البناء", "on-road-truck": "شاحنة", "on-road-bus": "حافلة" },
    categories: { truck: "شاحنة", bus: "حافلة", construction: "آلات البناء", agriculture: "الآلات الزراعية", "generator-set": "مولّد كهربائي", marine: "بحري" },
  },
};

export function formatBriefDate(date: string, language: BriefLanguage): string {
  const parsed = new Date(date.length === 10 ? `${date}T00:00:00.000Z` : date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(parsed);
}

export function formatBriefNumber(value: number, language: BriefLanguage): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 3 }).format(value);
}

export function briefCountryName(input: { iso2: string | null; nameEn: string; zhName?: string }, language: BriefLanguage): string {
  if (language === "zh-CN" && input.zhName) return input.zhName;
  if (!input.iso2) return input.nameEn;
  try {
    return new Intl.DisplayNames([language], { type: "region" }).of(input.iso2) ?? input.nameEn;
  } catch {
    return input.nameEn;
  }
}
