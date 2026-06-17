import type { ProfileAsset } from "@boss-agent/shared";

export const sampleProfileAssets: ProfileAsset[] = [
  {
    id: "edu-1",
    type: "education",
    title: "唐山师范学院｜信息管理与信息系统｜本科",
    content: "2023.09 - 2027.06，学习数据库、管理信息系统、统计学、电子商务、Python 数据分析等课程。",
    skillTags: ["SQL", "Python", "Excel", "管理信息系统"],
    directionTags: ["数据分析", "AI产品", "实施顾问"],
    evidenceLevel: "verified"
  },
  {
    id: "skill-1",
    type: "skill",
    title: "数据分析与业务指标",
    content: "掌握 SQL 查询、Excel 透视表、Python pandas 数据清洗，能围绕转化率、留存、活跃、GMV 等指标做分析。",
    skillTags: ["SQL", "Excel", "Python", "pandas", "指标体系"],
    directionTags: ["数据分析", "产品运营", "AI产品"],
    evidenceLevel: "verified"
  },
  {
    id: "project-1",
    type: "project",
    title: "AI 驱动的电商用户增长分析系统",
    content: "基于电商用户行为数据完成清洗、转化漏斗、留存和复购分析，设计经营看板，并规划自然语言查询指标的 AI 助手。",
    skillTags: ["SQL", "Python", "Power BI", "RAG", "PRD", "指标体系"],
    directionTags: ["数据分析", "AI产品", "产品运营", "AI Agent"],
    evidenceLevel: "verified"
  },
  {
    id: "project-2",
    type: "project",
    title: "企业知识库 RAG 助手",
    content: "使用 Dify/Coze 思路设计企业知识库问答流程，包括文档切分、召回、引用来源、badcase 记录和回答质量评估。",
    skillTags: ["RAG", "Dify", "Coze", "Prompt", "API"],
    directionTags: ["AI Agent", "AI产品", "实施顾问"],
    evidenceLevel: "needs_confirmation"
  },
  {
    id: "project-3",
    type: "project",
    title: "SaaS 订单与库存流程原型",
    content: "设计订单、库存、客户、审批流程，输出业务流程图、角色权限、异常流程和需求文档。",
    skillTags: ["SaaS", "ERP", "流程图", "PRD", "需求分析"],
    directionTags: ["实施顾问", "AI产品"],
    evidenceLevel: "verified"
  }
];
