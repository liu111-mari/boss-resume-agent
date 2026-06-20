import React from "react";
import type { Profile, ProfileItem } from "@boss-agent/shared";

import { Panel, FieldHint } from "@/components/ui";

type ProfileEditorProps = {
  profile: Profile;
  isSaving: boolean;
  onChange: (next: Profile) => void;
  onSave: () => void;
};

const itemCategoryOptions: Array<ProfileItem["category"]> = ["skill", "project", "intro", "other"];

export default function ProfileEditor({ profile, isSaving, onChange, onSave }: ProfileEditorProps) {
  return (
    <Panel
      id="profile-editor"
      title="个人信息库"
      description="这里存的才是模型允许引用的素材，缺什么就补什么，不要靠模型乱编。"
      actions={
        <button className="button button-secondary" disabled={isSaving} onClick={onSave} type="button">
          保存个人信息
        </button>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>学校</span>
          <input
            aria-label="学校"
            className="input"
            name="school"
            onChange={(event) => onChange({ ...profile, school: event.target.value })}
            value={profile.school}
          />
        </label>

        <label className="field">
          <span>专业</span>
          <input
            aria-label="专业"
            className="input"
            name="major"
            onChange={(event) => onChange({ ...profile, major: event.target.value })}
            value={profile.major}
          />
        </label>

        <label className="field">
          <span>毕业时间</span>
          <input
            aria-label="毕业时间"
            className="input"
            name="graduation"
            onChange={(event) => onChange({ ...profile, graduation: event.target.value })}
            value={profile.graduation}
          />
        </label>

        <label className="field">
          <span>求职方向</span>
          <input
            aria-label="求职方向"
            className="input"
            name="direction"
            onChange={(event) => onChange({ ...profile, direction: event.target.value })}
            value={profile.direction}
          />
        </label>
      </div>

      <div className="section-subheader">
        <div>
          <strong>素材条目</strong>
          <FieldHint>支持 skill / project / intro / other，标签用逗号分隔。</FieldHint>
        </div>
        <button className="button button-ghost" onClick={() => addItem(profile, onChange)} type="button">
          新增条目
        </button>
      </div>

      <div className="card-list">
        {profile.items.map((item) => (
          <article className="editor-card" key={item.id}>
            <div className="editor-card-toolbar">
              <label className="field">
                <span className="sr-only">条目类别</span>
                <select
                  aria-label={`条目类别-${item.id}`}
                  className="input"
                  onChange={(event) => updateItem(item.id, { category: event.target.value as ProfileItem["category"] }, profile, onChange)}
                  value={item.category}
                >
                  {itemCategoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="checkbox-field">
                <input
                  aria-label={`启用条目-${item.id}`}
                  checked={item.enabled}
                  onChange={(event) => updateItem(item.id, { enabled: event.target.checked }, profile, onChange)}
                  type="checkbox"
                />
                启用
              </label>

              <button className="button button-danger-ghost" onClick={() => removeItem(item.id, profile, onChange)} type="button">
                删除
              </button>
            </div>

            <label className="field">
              <span>内容</span>
              <textarea
                aria-label={`条目内容-${item.id}`}
                className="textarea"
                onChange={(event) => updateItem(item.id, { content: event.target.value }, profile, onChange)}
                value={item.content}
              />
            </label>

            <label className="field">
              <span>标签</span>
              <input
                aria-label={`条目标签-${item.id}`}
                className="input"
                onChange={(event) => updateItem(item.id, { tags: parseArrayInput(event.target.value) }, profile, onChange)}
                value={item.tags.join(", ")}
              />
            </label>
          </article>
        ))}

        {profile.items.length === 0 ? <p className="empty-state">还没有素材条目。先把能被引用的事实写进去。</p> : null}
      </div>
    </Panel>
  );
}

function addItem(profile: Profile, onChange: (next: Profile) => void) {
  onChange({
    ...profile,
    items: [
      ...profile.items,
      {
        id: globalThis.crypto.randomUUID(),
        category: "skill",
        content: "",
        tags: [],
        enabled: true
      }
    ]
  });
}

function removeItem(itemId: string, profile: Profile, onChange: (next: Profile) => void) {
  onChange({
    ...profile,
    items: profile.items.filter((item) => item.id !== itemId)
  });
}

function updateItem(
  itemId: string,
  patch: Partial<ProfileItem>,
  profile: Profile,
  onChange: (next: Profile) => void
) {
  onChange({
    ...profile,
    items: profile.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
  });
}

function parseArrayInput(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
