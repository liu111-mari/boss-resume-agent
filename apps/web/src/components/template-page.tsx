"use client";

import React from "react";
import { useEffect, useState } from "react";
import type { GreetingTask, GreetingTemplate } from "@boss-agent/shared";

import PageFeedback from "@/components/page-feedback";
import TemplateSettings from "@/components/template-settings";
import { PageHeader } from "@/components/ui";
import { loadTemplatePageData } from "@/lib/client-api";

const EMPTY_TEMPLATE: GreetingTemplate = {
  body: "",
  tone: "自然",
  minLength: 30,
  maxLength: 120,
  maxSkills: 2,
  maxProjects: 1,
  bannedPhrases: [],
  version: 1
};

export default function TemplatePage() {
  const [template, setTemplate] = useState<GreetingTemplate>(EMPTY_TEMPLATE);
  const [tasks, setTasks] = useState<GreetingTask[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    void loadTemplatePageData()
      .then((data) => {
        if (!active) return;
        setTemplate(data.template);
        setTasks(data.tasks);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "话术模板加载失败");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <PageHeader description="设置打招呼结构、语气和长度限制。" title="话术模板" />
      <PageFeedback error={error} status={status} />
      <TemplateSettings
        key={`template:${template.minLength}:${template.maxLength}:${template.maxSkills}:${template.maxProjects}:${template.version}`}
        onChange={setTemplate}
        onError={setError}
        onSaved={setTemplate}
        onStatus={setStatus}
        tasks={tasks}
        template={template}
      />
    </>
  );
}
