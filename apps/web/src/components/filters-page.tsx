"use client";

import React from "react";
import { useCallback, useEffect, useState } from "react";
import type { FilterConfig } from "@boss-agent/shared";

import FilterSettings from "@/components/filter-settings";
import PreferenceLearning from "@/components/preference-learning";
import PageFeedback from "@/components/page-feedback";
import { PageHeader } from "@/components/ui";
import { loadFiltersPageData } from "@/lib/client-api";
import type { GreetingPipelineRunCounts } from "@/lib/greeting-pipeline";

const EMPTY_CONFIG: FilterConfig = {
  filteringEnabled: true,
  targetTitles: [],
  cities: [],
  salaryUnit: "day",
  minSalary: null,
  maxSalary: null,
  employmentTypes: [],
  requiredKeywords: [],
  excludedKeywords: [],
  blockedCompanies: [],
  blockedIndustries: [],
  allowedExperience: [],
  allowedEducation: [],
  scoreThreshold: 70,
  dailyLimit: 100
};

export default function FiltersPage() {
  const [config, setConfig] = useState<FilterConfig>(EMPTY_CONFIG);
  const [lastRunCounts, setLastRunCounts] = useState<GreetingPipelineRunCounts | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const refreshOperationalData = useCallback(async () => {
    await Promise.resolve();
  }, []);

  useEffect(() => {
    let active = true;
    void loadFiltersPageData()
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch((cause) => {
        if (active) setError(getErrorMessage(cause, "筛选设置加载失败"));
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <PageHeader description="定义目标岗位并运行筛选与话术生成。" title="筛选设置" />
      <PageFeedback error={error} status={status} />
      <FilterSettings
        key={`filter:${config.minSalary ?? ""}:${config.maxSalary ?? ""}:${config.scoreThreshold}:${config.dailyLimit}`}
        config={config}
        lastRunCounts={lastRunCounts}
        onChange={setConfig}
        onError={setError}
        onOperationalRefresh={refreshOperationalData}
        onRunCompleted={setLastRunCounts}
        onSaved={setConfig}
        onStatus={setStatus}
      />
      <PreferenceLearning />
    </>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
