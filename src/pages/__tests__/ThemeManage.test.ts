import { describe, expect, it } from "vitest";
import {
  mergeManagedThemeSettingsDiff,
  patchMultiPingTaskSlots,
  rebaseThemeDraftAfterSave,
  shouldReseedThemeDraft,
} from "@/pages/ThemeManage";

describe("ThemeManage form helpers", () => {
  it("keeps multi-ping slot positions stable without shifting left or jumping slots", () => {
    // 选第 3 槽不得跳到第 1 槽
    expect(patchMultiPingTaskSlots([null, null, null], 2, "5")).toEqual([null, null, 5]);
    // 清空第 1 槽不得把第 2/3 槽左移
    expect(patchMultiPingTaskSlots([1, 2, 3], 0, "")).toEqual([null, 2, 3]);
    // 在另一槽选择已占用的任务应互换位置
    expect(patchMultiPingTaskSlots([1, 2, 3], 2, "1")).toEqual([3, 2, 1]);
  });

  it("merges only modified managed keys onto fresh remote settings to avoid overwriting concurrent saves", () => {
    const remoteSettings = {
      metricColors: { cpu: "#ff0000" },
      showRegionBar: false, // 其他页签刚保存的新值
      showGroupTabs: true,
      homepagePingTask: 99,
      homepagePingBindings: { "1": ["a"] },
    };
    const seededBaseline = {
      showRegionBar: true, // 本页草稿初始化时的基线
      showGroupTabs: true,
    };
    const draftManaged = {
      showRegionBar: true, // 本页未动过
      showGroupTabs: false, // 本页只改了这一项
    };

    const merged = mergeManagedThemeSettingsDiff(remoteSettings, seededBaseline, draftManaged);
    expect(merged).toEqual({
      metricColors: { cpu: "#ff0000" },
      showRegionBar: false,
      showGroupTabs: false,
      homepagePingBindings: { "1": ["a"] },
    });
  });

  it("preserves the seeded baseline across background public refetches so dirty saves do not revert peer edits", () => {
    const initialServer = {
      showGroupTabs: true,
      showRegionBar: true,
    };
    const seededBaseline = initialServer;
    const lastSeededSignature = JSON.stringify(seededBaseline);

    // 本页仅关闭分组栏（草稿相对基线已脏）
    const draft = {
      showGroupTabs: false,
      showRegionBar: true,
    };
    const isDirty = JSON.stringify(draft) !== JSON.stringify(seededBaseline);
    expect(isDirty).toBe(true);

    // 另一端关闭地区栏并保存，随后本页 public 查询刷新得到 refreshedServer
    const refreshedServer = {
      showGroupTabs: true,
      showRegionBar: false,
    };
    const refreshedSignature = JSON.stringify(refreshedServer);

    // 脏表单遇到后台刷新不得回灌草稿或替换基线
    expect(shouldReseedThemeDraft(lastSeededSignature, refreshedSignature, isDirty)).toBe(false);
    // 而未编辑的干净页签应接受刷新并更新基线
    expect(shouldReseedThemeDraft(lastSeededSignature, refreshedSignature, false)).toBe(true);

    // 仍以初始化时的 seededBaseline 比较差异，保存后地区栏保持 false、分组栏更新为 false
    const merged = mergeManagedThemeSettingsDiff(refreshedServer, seededBaseline, draft);
    expect(merged).toEqual({
      showGroupTabs: false,
      showRegionBar: false,
    });
  });

  it("rebases in-flight edits onto the newly saved baseline so reverting a toggle during save is not lost", () => {
    // 初始开启 → 关闭并提交保存 → 保存完成前重新开启
    const submittedDraft = {
      showGroupTabs: false,
      showRegionBar: true,
      showHomeOverview: true,
    };
    // 本次保存落库（同时合并进另一端刚保存的 showRegionBar: false）
    const savedDraft = {
      showGroupTabs: false,
      showRegionBar: false,
      showHomeOverview: true,
    };
    const latestDraftBeforeResolve = {
      showGroupTabs: true, // 保存请求完成前又改回开启
      showRegionBar: true, // 本页未动过
      showHomeOverview: false, // 保存请求完成前顺手关闭了总览
    };

    const rebased = rebaseThemeDraftAfterSave(
      savedDraft,
      submittedDraft,
      latestDraftBeforeResolve,
    );
    expect(rebased).toEqual({
      showGroupTabs: true, // 保留保存期间改回开启的最新编辑
      showRegionBar: false, // 吸收远端并发修改，防止下次保存回写覆盖
      showHomeOverview: false, // 保留保存期间的新增编辑
    });

    // 基线推进到 savedDraft 后，rebased 相对新基线仍为 dirty，且 public 回灌不会覆盖最后一次编辑
    const savedSignature = JSON.stringify(savedDraft);
    const isDirtyAfterSave = JSON.stringify(rebased) !== savedSignature;
    expect(isDirtyAfterSave).toBe(true);
    expect(shouldReseedThemeDraft(savedSignature, savedSignature, isDirtyAfterSave)).toBe(false);

    // 再次保存时仅提交提交后的两次改动，并保留远端 showRegionBar: false
    expect(mergeManagedThemeSettingsDiff(savedDraft, savedDraft, rebased)).toEqual({
      showGroupTabs: true,
      showRegionBar: false,
      showHomeOverview: false,
    });
  });
});
