import { observer } from "mobx-react-lite";
import { Chat } from "./components/Chat";
import { Conversations } from "./components/Conversations";
import { Registry } from "./components/Registry";
import { appStore } from "./store";

export const App = observer(function App() {
  const { project, error } = appStore;

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <strong>fe-harness</strong>
        </div>
        <Registry />
        <Conversations />
        { error ? <p className="error">{error}</p> : null}
      </aside>
      <section className="room">
        {project ? <Chat /> : null}
      </section>
    </div>
  );
});
