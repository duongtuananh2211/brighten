import { LiveProvider } from "../components/LiveProvider";
import { ServerShell } from "./server-shell";

export default function Home() {
  return (
    <LiveProvider>
      <ServerShell />
    </LiveProvider>
  );
}
