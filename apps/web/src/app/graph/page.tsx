import type { Metadata } from "next";
import { HydraGraph } from "../../components/HydraGraph";

export const metadata: Metadata = { title: "HydraDB knowledge graph | AVI-SPL meeting-room advisor" };
export const dynamic = "force-dynamic";

export default function GraphPage() {
  return <HydraGraph />;
}
