// 使用人通过之后推送分支并打开合并请求。已有合并请求时只更新描述。
import type { Store } from "../db/index.js";
import type { Provider } from "../db/index.js";
import { readStoredCard } from "./card.js";
import { ConversationError } from "./conversations.js";
import { callHost, HostError, remoteWithToken, submitMergeRequest, type MergeRequestInput } from "./hosts.js";
import { pushBranch } from "./worktree.js";

/** 创建或更新合并请求时交给托管适配器的内容，不含令牌。 */
export type MergeDraft = {
  repoUrl: string;
  title: string;
  description: string;
  head: string;
  base: string;
  mrUrl: string | null;
};

/** 推送和托管调用。测试传入假实现，正式运行使用配置里的令牌。 */
export type MergeGateway = {
  push(cwd: string, branch: string, repoUrl: string, provider: Provider): Promise<void>;
  submit(provider: Provider, draft: MergeDraft): Promise<string>;
};

/** 用配置中的令牌推送，并调用对应代码托管的接口。 */
export function liveMergeGateway(tokens: {
  githubToken: string;
  gitlabToken: string;
  azureDevOpsToken: string;
}): MergeGateway {
  return {
    async push(cwd, branch, repoUrl, provider) {
      const remote = remoteWithToken(provider, repoUrl, tokenFor(tokens, provider));
      await pushBranch(cwd, branch, remote);
    },
    submit(provider, draft) {
      const input: MergeRequestInput = { ...draft, token: tokenFor(tokens, provider) };
      return submitMergeRequest(provider, input, callHost);
    },
  };
}

/** 还没有合并请求时推送分支并新建一份。返回合并请求地址。 */
export async function createMergeRequest(store: Store, conversationId: string, gateway: MergeGateway): Promise<string> {
  const ready = readyMerge(store, conversationId);
  await gateway.push(ready.cwd, ready.branch, ready.project.repoUrl, ready.project.provider);
  return gateway.submit(ready.project.provider, draftOf(ready, null));
}

/** 已有合并请求时再次推送，并只更新标题和描述。 */
export async function updateMergeRequest(store: Store, conversationId: string, gateway: MergeGateway): Promise<void> {
  const ready = readyMerge(store, conversationId);
  if (!ready.conversation.mrUrl) return;
  await gateway.push(ready.cwd, ready.branch, ready.project.repoUrl, ready.project.provider);
  await gateway.submit(ready.project.provider, draftOf(ready, ready.conversation.mrUrl));
}

/** 把托管或推送失败收成对话错误，方便接口把原因返回给页面。 */
export function asConversationError(err: unknown, fallback: string): ConversationError {
  if (err instanceof ConversationError) return err;
  const message = err instanceof HostError || err instanceof Error ? err.message : fallback;
  return new ConversationError(message || fallback, 502);
}

function readyMerge(store: Store, conversationId: string) {
  const conversation = store.conversation(conversationId);
  if (!conversation) throw new ConversationError("对话不存在", 404);
  const project = store.project(conversation.projectId);
  if (!project) throw new ConversationError("仓库不存在", 404);
  const stored = readStoredCard(conversation.changeCard);
  if (!stored?.frozen) throw new ConversationError("变更卡还没确认", 400);
  if (!conversation.worktreePath || !conversation.branch) throw new ConversationError("还没有可以推送的分支", 409);
  return { conversation, project, card: stored.card, cwd: conversation.worktreePath, branch: conversation.branch };
}

function draftOf(ready: ReturnType<typeof readyMerge>, mrUrl: string | null): MergeDraft {
  const preview = ready.conversation.previewUrl ?? "没有";
  return {
    repoUrl: ready.project.repoUrl,
    title: ready.card.goal,
    description: `${ready.card.summary}\n\n预览地址：${preview}\n对话 id：${ready.conversation.id}`,
    head: ready.branch,
    base: ready.project.startingRef,
    mrUrl,
  };
}

function tokenFor(
  tokens: { githubToken: string; gitlabToken: string; azureDevOpsToken: string },
  provider: Provider,
): string {
  if (provider === "github") return tokens.githubToken;
  if (provider === "gitlab") return tokens.gitlabToken;
  return tokens.azureDevOpsToken;
}
