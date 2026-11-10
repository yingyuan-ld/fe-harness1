import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { type ProjectRecord, type Provider, Store } from "../db/index.js";
import { FakeAgent } from "../src/agent.js";
import { Live } from "../src/conversations.js";
import { remoteWithToken, submitMergeRequest, type HostRequest, type MergeRequestInput } from "../src/hosts.js";
import { passPreview, runImplement, runRevise } from "../src/implement.js";
import { stopPreview } from "../src/preview.js";
import { type MergeDraft, type MergeGateway } from "../src/publish.js";
import { pushBranch, removeWorktree } from "../src/worktree.js";

const card = {
  goal: "把首页标题改一下",
  pages: "首页",
  acceptance: ["打开首页能看到新标题"],
  outOfScope: [],
  summary: "只改首页标题",
  frozen: true,
};

test("三种托管都从同一组调用创建和更新合并请求", async () => {
  const github = await capture("github", "https://github.com/acme/web.git", null, { html_url: "https://github.com/acme/web/pull/4" });
  assert.equal(github.url, "https://github.com/acme/web/pull/4");
  assert.equal(github.request.method, "POST");
  assert.equal(github.request.url, "https://api.github.com/repos/acme/web/pulls");
  assert.equal(github.request.headers.authorization, "Bearer token-1");
  assert.deepEqual(github.request.body, {
    title: "改标题",
    body: "只改首页标题",
    head: "fe/abcdef12",
    base: "main",
  });

  const githubUpdate = await capture(
    "github",
    "https://github.com/acme/web.git",
    "https://github.com/acme/web/pull/4",
    { html_url: "https://github.com/acme/web/pull/4" },
  );
  assert.equal(githubUpdate.request.method, "PATCH");
  assert.equal(githubUpdate.request.url, "https://api.github.com/repos/acme/web/pulls/4");
  assert.deepEqual(githubUpdate.request.body, { title: "改标题", body: "只改首页标题" });

  const gitlab = await capture(
    "gitlab",
    "https://gitlab.example.com/group/sub/web.git",
    null,
    { web_url: "https://gitlab.example.com/group/sub/web/-/merge_requests/9" },
  );
  assert.equal(gitlab.request.method, "POST");
  assert.equal(
    gitlab.request.url,
    "https://gitlab.example.com/api/v4/projects/group%2Fsub%2Fweb/merge_requests",
  );
  assert.equal(gitlab.request.headers["PRIVATE-TOKEN"], "token-1");
  assert.deepEqual(gitlab.request.body, {
    source_branch: "fe/abcdef12",
    target_branch: "main",
    title: "改标题",
    description: "只改首页标题",
  });

  const gitlabUpdate = await capture(
    "gitlab",
    "https://gitlab.example.com/group/sub/web.git",
    "https://gitlab.example.com/group/sub/web/-/merge_requests/9",
    { web_url: "https://gitlab.example.com/group/sub/web/-/merge_requests/9" },
  );
  assert.equal(gitlabUpdate.request.method, "PUT");
  assert.equal(
    gitlabUpdate.request.url,
    "https://gitlab.example.com/api/v4/projects/group%2Fsub%2Fweb/merge_requests/9",
  );

  const azure = await capture(
    "azure-devops",
    "https://dev.azure.com/org/proj/_git/web",
    null,
    { pullRequestId: 7 },
  );
  assert.equal(azure.url, "https://dev.azure.com/org/proj/_git/web/pullrequest/7");
  assert.equal(azure.request.method, "POST");
  assert.equal(
    azure.request.url,
    "https://dev.azure.com/org/proj/_apis/git/repositories/web/pullrequests?api-version=7.1",
  );
  assert.equal(Buffer.from(azure.request.headers.authorization.slice("Basic ".length), "base64").toString(), ":token-1");
  assert.deepEqual(azure.request.body, {
    title: "改标题",
    description: "只改首页标题",
    sourceRefName: "refs/heads/fe/abcdef12",
    targetRefName: "refs/heads/main",
  });

  const azureUpdate = await capture(
    "azure-devops",
    "https://dev.azure.com/org/proj/_git/web",
    "https://dev.azure.com/org/proj/_git/web/pullrequest/7",
    { pullRequestId: 7 },
  );
  assert.equal(azureUpdate.request.method, "PATCH");
  assert.equal(
    azureUpdate.request.url,
    "https://dev.azure.com/org/proj/_apis/git/repositories/web/pullrequests/7?api-version=7.1",
  );
  assert.deepEqual(azureUpdate.request.body, { title: "改标题", description: "只改首页标题" });
});

test("https 仓库地址会带上对应托管的令牌，本地路径保持原样", () => {
  const remote = new URL(remoteWithToken("gitlab", "https://gitlab.com/acme/web.git", "token-1"));
  assert.equal(remote.username, "oauth2");
  assert.equal(remote.password, "token-1");
  assert.equal(remoteWithToken("github", "E:/fe/repo", ""), "E:/fe/repo");
  assert.throws(() => remoteWithToken("azure-devops", "https://dev.azure.com/org/proj/_git/web", ""), /Azure DevOps/);
});

test("点通过后推送并创建一次合并请求，通过前不推送", async () => {
  const harness = prepare("fe-m10-create-", "cccccccc-3456-7890-abcd-ef1234567890");
  harness.agent.replies.push("改好了。");
  harness.agent.beforeWait = (cwd) => commit(cwd, "v2\n");
  try {
    await runImplement(harness.store, harness.live, harness.agent, harness.dataDir, harness.id, "127.0.0.1", harness.gateway);
    assert.equal(harness.store.conversation(harness.id)?.status, "待验收");
    assert.equal(harness.calls.pushed.length, 0);
    assert.equal(harness.calls.drafts.length, 0);

    await passPreview(harness.store, harness.live, harness.id, harness.gateway);
    const conversation = harness.store.conversation(harness.id);
    assert.equal(conversation?.status, "待合并");
    assert.equal(conversation?.mrUrl, "https://github.com/acme/web/pull/1");
    assert.deepEqual(harness.calls.pushed, ["fe/cccccccc"]);
    assert.equal(harness.calls.drafts.length, 1);
    assert.equal(harness.calls.drafts[0]?.mrUrl, null);
    assert.equal(harness.calls.drafts[0]?.title, "把首页标题改一下");
    assert.equal(harness.calls.drafts[0]?.base, "main");
    assert.equal(harness.calls.drafts[0]?.head, "fe/cccccccc");
    assert.match(harness.calls.drafts[0]?.description ?? "", /只改首页标题/);
    assert.match(harness.calls.drafts[0]?.description ?? "", /http:\/\/127\.0\.0\.1:9\//);
    assert.match(harness.calls.drafts[0]?.description ?? "", new RegExp(harness.id));
    git(harness.bare, ["rev-parse", "--verify", "refs/heads/fe/cccccccc"]);
  } finally {
    await harness.cleanup();
  }
});

test("没通过时不推送，也不创建合并请求", async () => {
  const harness = prepare("fe-m10-skip-", "dddddddd-3456-7890-abcd-ef1234567890", "node -e process.exit(0)");
  harness.agent.replies.push("没有改动。");
  try {
    await runImplement(harness.store, harness.live, harness.agent, harness.dataDir, harness.id, "127.0.0.1", harness.gateway);
    assert.equal(harness.store.conversation(harness.id)?.status, "未通过");
    await assert.rejects(() => passPreview(harness.store, harness.live, harness.id, harness.gateway), /现在还不能通过/);
    assert.equal(harness.calls.pushed.length, 0);
    assert.equal(harness.calls.drafts.length, 0);
    assert.equal(harness.store.conversation(harness.id)?.mrUrl, null);
  } finally {
    await harness.cleanup();
  }
});

test("返工结束后只更新已有合并请求", async () => {
  const harness = prepare("fe-m10-revise-", "eeeeeeee-3456-7890-abcd-ef1234567890");
  harness.agent.replies.push("改好了。", "又改了一处。");
  harness.agent.beforeWait = (cwd) => commit(cwd, "v2\n");
  try {
    await runImplement(harness.store, harness.live, harness.agent, harness.dataDir, harness.id, "127.0.0.1", harness.gateway);
    await passPreview(harness.store, harness.live, harness.id, harness.gateway);
    const mrUrl = harness.store.conversation(harness.id)?.mrUrl;
    harness.agent.beforeWait = (cwd) => commit(cwd, "v3\n");
    await runRevise(harness.store, harness.live, harness.agent, harness.dataDir, harness.id, "标题再大一点", "127.0.0.1", harness.gateway);
    assert.equal(harness.store.conversation(harness.id)?.status, "待验收");
    assert.equal(harness.store.conversation(harness.id)?.mrUrl, mrUrl);
    assert.deepEqual(harness.calls.pushed, ["fe/eeeeeeee", "fe/eeeeeeee"]);
    assert.equal(harness.calls.drafts.filter((item) => item.mrUrl == null).length, 1);
    assert.equal(harness.calls.drafts.filter((item) => item.mrUrl === mrUrl).length, 1);
    assert.match(harness.calls.drafts[1]?.description ?? "", /只改首页标题/);
    assert.ok(harness.store.messages(harness.id).some((item) => item.body === "已更新合并请求。"));

    await passPreview(harness.store, harness.live, harness.id, harness.gateway);
    assert.equal(harness.store.conversation(harness.id)?.status, "待合并");
    assert.equal(harness.calls.drafts.filter((item) => item.mrUrl == null).length, 1);
    assert.equal(harness.calls.pushed.length, 2);
  } finally {
    await harness.cleanup();
  }
});

async function capture(
  provider: Provider,
  repoUrl: string,
  mrUrl: string | null,
  body: unknown,
): Promise<{ url: string; request: HostRequest }> {
  let request: HostRequest | undefined;
  const url = await submitMergeRequest(
    provider,
    input(repoUrl, mrUrl),
    async (next) => {
      request = next;
      return body;
    },
  );
  if (!request) throw new Error("没有发出托管请求");
  return { url, request };
}

function input(repoUrl: string, mrUrl: string | null): MergeRequestInput {
  return {
    repoUrl,
    token: "token-1",
    title: "改标题",
    description: "只改首页标题",
    head: "fe/abcdef12",
    base: "main",
    mrUrl,
  };
}

function prepare(prefix: string, id: string, devCommand?: string) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const repo = path.join(root, "repo");
  const bare = path.join(root, "bare.git");
  const dataDir = path.join(root, "data");
  const stub = path.join(root, "preview-stub.js");
  mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  writeFileSync(path.join(repo, "readme.txt"), "v1\n");
  git(repo, ["add", "readme.txt"]);
  git(repo, ["commit", "-m", "init"]);
  mkdirSync(bare);
  git(bare, ["init", "--bare"]);
  writeFileSync(stub, "console.log('http://127.0.0.1:9/');\nsetInterval(() => {}, 1000);\n");
  const remote = bare.replaceAll("\\", "/");

  const store = new Store(dataDir);
  const live = new Live();
  const agent = new FakeAgent();
  const calls: { pushed: string[]; drafts: MergeDraft[] } = { pushed: [], drafts: [] };
  store.saveProject({
    ...project(repo),
    repoUrl: remote,
    devCommand: devCommand ?? `node "${stub}"`,
  });
  store.insertConversation({ id, projectId: "p1", status: "待确认" });
  store.patchConversation(id, { changeCard: card });
  const gateway: MergeGateway = {
    async push(cwd, branch) {
      await pushBranch(cwd, branch, remote);
      calls.pushed.push(branch);
    },
    async submit(_provider, draft) {
      calls.drafts.push(draft);
      return draft.mrUrl ?? "https://github.com/acme/web/pull/1";
    },
  };
  return {
    store,
    live,
    agent,
    dataDir,
    bare,
    id,
    calls,
    gateway,
    cleanup: async () => {
      await stopPreview(id);
      if (store.conversation(id)?.worktreePath) await removeWorktree(store, dataDir, id).catch(() => undefined);
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function project(localPath: string): ProjectRecord {
  return {
    id: "p1",
    name: "示例",
    repoUrl: "https://github.com/acme/web.git",
    localPath,
    provider: "github",
    startingRef: "main",
    testCommand: "npm test",
    devCommand: "npm run dev",
  };
}

function commit(cwd: string, content: string): void {
  writeFileSync(path.join(cwd, "readme.txt"), content);
  git(cwd, ["add", "readme.txt"]);
  git(cwd, ["commit", "-m", "change"]);
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "fe",
      GIT_AUTHOR_EMAIL: "fe@example.com",
      GIT_COMMITTER_NAME: "fe",
      GIT_COMMITTER_EMAIL: "fe@example.com",
    },
  }).trim();
}
