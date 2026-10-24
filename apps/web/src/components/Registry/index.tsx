// 仓库维护
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { listProjects, type Project } from "../../api";
import { appStore } from "../../store";
import { RegistryForm } from "./RegistryForm";

/** 侧栏里的仓库：列表、选中、登记和编辑。 */
export const Registry = observer(function Registry() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState<Project | "create" | null>(null);
  const project = appStore.project;

  async function load() {
    const result = await listProjects();
    setProjects(result.projects);
    const next = result.projects.find((item) => item.id === appStore.project?.id) ?? result.projects[0] ?? null;
    appStore.selectProject(next);
  }

  useEffect(() => {
    load().catch((err: unknown) => appStore.setError(err instanceof Error ? err.message : "加载失败"));
  }, []);

  function choose(id: string) {
    if (id === project?.id) return;
    appStore.selectProject(projects.find((item) => item.id === id) ?? null);
  }

  return (
    <>
      <button type="button" onClick={() => setForm("create")}>
        登记仓库
      </button>
      <ul className="repos">
        {projects.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={item.id === project?.id ? "thread active" : "thread"}
              onClick={() => choose(item.id)}
            >
              <span>{item.name}</span>
              <small>{item.startingRef}</small>
            </button>
          </li>
        ))}
      </ul>
      {project ? <p className="hint">{project.localPath}</p> : null}
      {project ? (
        <button type="button" className="ghost" onClick={() => setForm(project)}>
          编辑这个仓库
        </button>
      ) : null}
      {form !== null ? (
        <RegistryForm
          project={form === "create" ? null : form}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            setForm(null);
            appStore.selectProject(saved);
            load().catch((err: unknown) => appStore.setError(err instanceof Error ? err.message : "加载失败"));
          }}
        />
      ) : null}
    </>
  );
});
