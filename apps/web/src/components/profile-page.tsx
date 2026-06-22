"use client";

import React from "react";
import { useEffect, useState } from "react";
import type { Profile } from "@boss-agent/shared";

import PageFeedback from "@/components/page-feedback";
import ProfileEditor from "@/components/profile-editor";
import { PageHeader } from "@/components/ui";
import { loadProfilePageData } from "@/lib/client-api";

const EMPTY_PROFILE: Profile = {
  school: "",
  major: "",
  graduation: "",
  direction: "",
  items: []
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    void loadProfilePageData()
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "个人资料加载失败");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <PageHeader description="维护可被模型安全引用的真实教育、技能和项目素材。" title="个人资料" />
      <PageFeedback error={error} status={status} />
      <ProfileEditor
        onChange={setProfile}
        onError={setError}
        onSaved={setProfile}
        onStatus={setStatus}
        profile={profile}
      />
    </>
  );
}
