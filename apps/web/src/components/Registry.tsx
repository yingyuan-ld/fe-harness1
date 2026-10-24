import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, addProject, updateProject, type Project, type Provider } from "../api";

const PROVIDER_LABEL: Record<Provider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  "azure-devops": "Azure DevOps",
};

export function Registry({
  project,
  onClose,
  onSaved,
}: {
  project?: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl ?? "");
  const [provider, setProvider] = useState<Provider>(project?.provider ?? "github");
  const [startingRef, setStartingRef] = useState(project?.startingRef ?? "main");
  const [testCommand, setTestCommand] = useState(project?.testCommand ?? "npm test");
  const [localPath, setLocalPath] = useState(project?.localPath ?? "");
  const [devCommand, setDevCommand] = useState(project?.devCommand ?? "npm run dev");
  const [checks, setChecks] = useState(project?.requiredChecks.join("，") ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    const input = {
      name,
      repoUrl,
      provider,
      startingRef,
      testCommand,
      localPath,
      devCommand,
      requiredChecks: checks
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    };
    try {
      const result = project ? await updateProject(project.id, input) : await addProject(input);
      onSaved(result.project);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "登记失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal">
      <form className="panel" onSubmit={submit}>
        <h2>{project ? "编辑仓库" : "登记仓库"}</h2>
        <label>
          名称
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          仓库地址
          <input
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/org/repo"
          />
        </label>
        <label>
          代码托管
          <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
            {(Object.keys(PROVIDER_LABEL) as Provider[]).map((item) => (
              <option key={item} value={item}>
                {PROVIDER_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
        <label>
          起始分支
          <input value={startingRef} onChange={(event) => setStartingRef(event.target.value)} />
        </label>
        <label>
          测试命令
          <input value={testCommand} onChange={(event) => setTestCommand(event.target.value)} />
        </label>
        <label>
          本机目录
          <input
            value={localPath}
            onChange={(event) => setLocalPath(event.target.value)}
            placeholder="E:\fe\repo"
          />
        </label>
        <p className="hint">本机目录必须是 git 仓库，并且起始分支已经存在。</p>
        <label>
          开发命令
          <input value={devCommand} onChange={(event) => setDevCommand(event.target.value)} />
        </label>
        <label>
          必须通过的检查，用逗号分开
          <input value={checks} onChange={(event) => setChecks(event.target.value)} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="submit" disabled={saving}>
            {saving ? "正在保存…" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
